'use client'

import Editor, { loader, type Monaco } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

loader.config({ monaco })

const PI_EXTENSION_TYPES = `
declare module '@earendil-works/pi-coding-agent' {
  export interface ExtensionUIContext {
    select(title: string, options: string[]): Promise<string | undefined>
    confirm(title: string, message: string): Promise<boolean>
    input(title: string, placeholder?: string): Promise<string | undefined>
    notify(message: string, type?: 'info' | 'warning' | 'error'): void
    setStatus(key: string, text?: string): void
    setWidget(key: string, content?: string[]): void
  }
  export interface ExtensionContext { ui: ExtensionUIContext }
  export interface ExtensionAPI {
    on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void
    registerTool(definition: any): void
    registerCommand(name: string, definition: any): void
    registerProvider(name: string, definition: any): void
    appendEntry(type: string, data?: unknown): void
  }
}
declare module 'typebox' {
  export const Type: {
    Object(properties: Record<string, unknown>, options?: unknown): unknown
    String(options?: unknown): unknown
    Number(options?: unknown): unknown
    Boolean(options?: unknown): unknown
    Array(item: unknown, options?: unknown): unknown
    Optional(item: unknown): unknown
    Literal(value: string | number | boolean): unknown
  }
}
`

function configureMonaco(instance: Monaco) {
  instance.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: instance.languages.typescript.ScriptTarget.ES2022,
    module: instance.languages.typescript.ModuleKind.ESNext,
    moduleResolution: instance.languages.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    strict: true,
    noEmit: true,
  })
  instance.languages.typescript.typescriptDefaults.addExtraLib(
    PI_EXTENSION_TYPES,
    'file:///pi-studio-extension-api.d.ts',
  )
  instance.editor.defineTheme('pi-studio', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7A766D', fontStyle: 'italic' },
      { token: 'keyword', foreground: '315B8A' },
      { token: 'string', foreground: '2F7153' },
      { token: 'number', foreground: '985B2A' },
      { token: 'type.identifier', foreground: '674B86' },
    ],
    colors: {
      'editor.background': '#F8F6EF',
      'editor.foreground': '#34333A',
      'editorLineNumber.foreground': '#A09B90',
      'editorLineNumber.activeForeground': '#50505B',
      'editor.selectionBackground': '#C9D8E8',
      'editor.inactiveSelectionBackground': '#DEE5EA',
      'editor.lineHighlightBackground': '#EFECE3',
      'editorIndentGuide.background1': '#DDD8CD',
      'editorIndentGuide.activeBackground1': '#B7B0A2',
      'editorWidget.background': '#FBFAF5',
      'editorWidget.border': '#D4CFC3',
    },
  })
}

export function ExtensionsEditor({
  path,
  value,
  onChange,
  readOnly,
}: {
  path: string
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}) {
  const language = /\.json$/i.test(path)
    ? 'json'
    : /\.md$/i.test(path)
      ? 'markdown'
      : /\.[cm]?jsx?$/i.test(path)
        ? 'javascript'
        : /\.[cm]?tsx?$/i.test(path)
          ? 'typescript'
          : 'plaintext'

  return (
    <Editor
      path={`file:///extension/${path}`}
      language={language}
      value={value}
      beforeMount={configureMonaco}
      theme="pi-studio"
      onChange={(next) => onChange(next ?? '')}
      loading={
        <div className="h-full animate-pulse bg-[linear-gradient(90deg,transparent,rgba(80,80,80,0.06),transparent)] bg-size-[220%_100%]" />
      }
      options={{
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        lineHeight: 21,
        padding: { top: 14, bottom: 14 },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        wordWrap: 'on',
        tabSize: 2,
        formatOnPaste: true,
        formatOnType: true,
        suggest: { showWords: false },
      }}
    />
  )
}
