import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from 'react'
import type { Course, CourseTheme, MediaRef, Page, PageMediaKind, Quiz, ScormVersion } from './lib/types'
import { DEFAULT_THEME } from './lib/theme'
import { loadProject, saveProject, pruneMedia, referencedMediaIds } from './lib/db'

export interface EditorState {
  course: Course
  selectedId: string | null
  /** false until the IndexedDB restore finishes — saves are suppressed to avoid clobbering. */
  loaded: boolean
}

export type Action =
  | { type: 'load'; course: Course | null }
  | { type: 'setTitle'; title: string }
  | { type: 'setPassMark'; passMark: number }
  | { type: 'setScormVersion'; version: ScormVersion }
  | { type: 'addPage'; page?: Page }
  | { type: 'deletePage'; id: string }
  | { type: 'movePage'; from: number; to: number }
  | { type: 'select'; id: string }
  | { type: 'patchPage'; id: string; patch: Partial<Pick<Page, 'title' | 'body' | 'blocks'>> }
  | { type: 'setMedia'; id: string; kind: PageMediaKind; ref: MediaRef | null }
  | { type: 'setQuiz'; id: string; quiz: Quiz | null }
  | { type: 'patchCourse'; patch: Partial<Pick<Course, 'maxAttempts' | 'shuffleQuestions' | 'shuffleOptions' | 'navMode' | 'onFailPageId'>> }
  | { type: 'patchTheme'; patch: Partial<CourseTheme> | null }

export function newPage(n: number): Page {
  return { id: crypto.randomUUID(), title: `Page ${n}`, body: '', video: null, image: null, quiz: null }
}

const initial: EditorState = {
  course: { title: 'Untitled Course', passMark: 70, scormVersion: '1.2', pages: [] },
  selectedId: null,
  loaded: false,
}

function patchPage(course: Course, id: string, fn: (p: Page) => Page): Course {
  return { ...course, pages: course.pages.map((p) => (p.id === id ? fn(p) : p)) }
}

/** Exported for direct unit testing. */
export function reducer(state: EditorState, a: Action): EditorState {
  switch (a.type) {
    case 'load': {
      const course = a.course ?? state.course
      return { course, selectedId: course.pages[0]?.id ?? null, loaded: true }
    }
    case 'setTitle':
      return { ...state, course: { ...state.course, title: a.title } }
    case 'setPassMark': {
      const passMark = Number.isFinite(a.passMark) ? Math.max(0, Math.min(100, Math.round(a.passMark))) : 70
      return { ...state, course: { ...state.course, passMark } }
    }
    case 'setScormVersion':
      return { ...state, course: { ...state.course, scormVersion: a.version } }
    case 'addPage': {
      const p = a.page ?? newPage(state.course.pages.length + 1)
      return { ...state, course: { ...state.course, pages: [...state.course.pages, p] }, selectedId: p.id }
    }
    case 'deletePage': {
      const i = state.course.pages.findIndex((p) => p.id === a.id)
      if (i < 0) return state
      const pages = state.course.pages.filter((p) => p.id !== a.id)
      const selectedId = state.selectedId === a.id ? (pages[Math.max(0, i - 1)]?.id ?? null) : state.selectedId
      const course = { ...state.course, pages }
      if (course.onFailPageId === a.id) delete course.onFailPageId // keep the remediation pointer clean
      return { ...state, course, selectedId }
    }
    case 'movePage': {
      const pages = [...state.course.pages]
      if (a.to < 0 || a.to >= pages.length || a.from === a.to) return state
      const [x] = pages.splice(a.from, 1)
      pages.splice(a.to, 0, x)
      return { ...state, course: { ...state.course, pages } }
    }
    case 'select':
      return { ...state, selectedId: a.id }
    case 'patchPage':
      return { ...state, course: patchPage(state.course, a.id, (p) => ({ ...p, ...a.patch })) }
    case 'setMedia':
      return { ...state, course: patchPage(state.course, a.id, (p) => ({ ...p, [a.kind]: a.ref })) }
    case 'setQuiz':
      return { ...state, course: patchPage(state.course, a.id, (p) => ({ ...p, quiz: a.quiz })) }
    case 'patchCourse':
      return { ...state, course: { ...state.course, ...a.patch } }
    case 'patchTheme': {
      // null = reset to the built-in look; patches merge over the defaults
      const theme = a.patch === null ? null : { ...(state.course.theme ?? DEFAULT_THEME), ...a.patch }
      return { ...state, course: { ...state.course, theme } }
    }
  }
}

const StateCtx = createContext<EditorState>(initial)
const DispatchCtx = createContext<Dispatch<Action>>(() => {})

export function useEditor(): EditorState {
  return useContext(StateCtx)
}
export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchCtx)
}
export function useSelectedPage(): Page | null {
  const { course, selectedId } = useEditor()
  return course.pages.find((p) => p.id === selectedId) ?? null
}

export function CourseProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    loadProject()
      .then((course) => dispatch({ type: 'load', course }))
      .catch(() => dispatch({ type: 'load', course: null }))
  }, [])

  // debounced autosave + orphaned-blob GC
  useEffect(() => {
    if (!state.loaded) return
    clearTimeout(saveTimer.current)
    const course = state.course
    saveTimer.current = setTimeout(() => {
      saveProject(course)
        .then(() => pruneMedia(referencedMediaIds(course)))
        .catch((err) => console.error('autosave failed', err))
    }, 500)
    return () => clearTimeout(saveTimer.current)
  }, [state.course, state.loaded])

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}
