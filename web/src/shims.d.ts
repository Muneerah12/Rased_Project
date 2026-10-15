// Minimal React type declarations. The offline build environment has no
// @types/react, so these cover the React API surface this project uses.
declare module 'react' {
  export type ReactNode = any;
  export type Key = string | number;
  export interface Context<T> { Provider: any; Consumer: any }
  export type SetState<T> = (v: T | ((prev: T) => T)) => void;
  export function useState<T>(init: T | (() => T)): [T, SetState<T>];
  export function useReducer<S, A>(r: (s: S, a: A) => S, init: S): [S, (a: A) => void];
  export function useEffect(f: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(f: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(f: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(f: T, deps: readonly unknown[]): T;
  export function useRef<T>(v: T): { current: T };
  export function useId(): string;
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export const Fragment: any;
  export const StrictMode: any;
  export function memo<T>(c: T): T;
  export type CSSProperties = { [k: string]: string | number | undefined };
  const React: any;
  export default React;
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements { [el: string]: any }
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { key?: string | number }
  }
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: any): void };
}
// Vite build-time variables; undefined when a module runs outside Vite (tsx tests).
interface ImportMeta { readonly env?: { readonly VITE_API_BASE?: string; readonly VITE_DEMO_CPS?: string } }
declare module '*.webp' { const src: string; export default src }
declare module '*.png' { const src: string; export default src }
declare module '*.css' { const css: string; export default css }
declare module '*.jpg' { const src: string; export default src }
