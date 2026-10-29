// Tells TypeScript that importing a .sql file with `?raw` gives its text as a string (Vite does the bundling).
declare module '*.sql?raw' {
  const sql: string
  export default sql
}
