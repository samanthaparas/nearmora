/**
 * Lets a screen with unsaved work intercept navigation (blueprint: never silently discard unsaved changes).
 * The screen registers a guard; App asks it before switching sections. One window, so one guard at a time.
 */

/** Return true to take over (the guard will call `proceed` later, if the person chooses to leave); false to let it go. */
export type NavigationGuard = (proceed: () => void) => boolean

let current: NavigationGuard | null = null

export function setNavigationGuard(guard: NavigationGuard | null): void {
  current = guard
}

/** Runs `proceed` now, unless a guard takes over. */
export function navigate(proceed: () => void): void {
  if (current?.(proceed)) return
  proceed()
}
