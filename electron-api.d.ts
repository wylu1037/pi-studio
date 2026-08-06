export {}

declare global {
  interface Window {
    piStudio?: {
      selectEnvFile: () => Promise<string | null>
      selectSkillFolder: () => Promise<string | null>
    }
  }
}
