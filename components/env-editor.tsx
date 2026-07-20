'use client'

import { useEffect, useRef } from 'react'
import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

loader.config({ monaco })

function configureEnvMonaco(instance: Monaco) {
  if (
    !instance.languages.getLanguages().some((language: { id: string }) => language.id === 'dotenv')
  ) {
    instance.languages.register({ id: 'dotenv' })
    instance.languages.setMonarchTokensProvider('dotenv', {
      tokenizer: {
        root: [
          [/^\s*#.*$/, 'comment'],
          [/^\s*(export)(\s+)/, ['keyword', 'white']],
          [/^[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/, 'key'],
          [/\$\{[A-Za-z_][A-Za-z0-9_]*\}/, 'variable'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'[^']*'/, 'string'],
          [/\b(?:true|false|null)\b/, 'keyword'],
          [/-?\d+(?:\.\d+)?/, 'number'],
          [/=/, 'operator'],
        ],
      },
    })
  }

  instance.editor.defineTheme('pi-studio-env', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8A857B', fontStyle: 'italic' },
      { token: 'keyword', foreground: '315B8A' },
      { token: 'key', foreground: '3C566F' },
      { token: 'operator', foreground: '8A857B' },
      { token: 'string', foreground: '2F7153' },
      { token: 'number', foreground: '985B2A' },
      { token: 'variable', foreground: '674B86' },
    ],
    colors: {
      'editor.background': '#F8F6EF',
      'editor.foreground': '#34333A',
      'editorLineNumber.foreground': '#AAA499',
      'editorLineNumber.activeForeground': '#50505B',
      'editor.selectionBackground': '#C9D8E8',
      'editor.inactiveSelectionBackground': '#DEE5EA',
      'editor.lineHighlightBackground': '#EFECE3',
      'editorIndentGuide.background1': '#E5E0D6',
      'editorIndentGuide.activeBackground1': '#B7B0A2',
      'editorCursor.foreground': '#315B8A',
      'editorWidget.background': '#FBFAF5',
      'editorWidget.border': '#D4CFC3',
      'editor.findMatchBackground': '#D8C79A',
      'editor.findMatchHighlightBackground': '#E7DEC5',
    },
  })
}

export function EnvEditor({
  path,
  versionId,
  value,
  readOnly,
  onChange,
  onSave,
}: {
  path: string
  versionId: string
  value: string
  readOnly?: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const handleMount: OnMount = (editor, instance) => {
    editor.addCommand(instance.KeyMod.CtrlCmd | instance.KeyCode.KeyS, () => onSaveRef.current())
    editor.focus()
  }

  return (
    <Editor
      path={`file:///environment/${encodeURIComponent(path)}/${versionId}.env`}
      language="dotenv"
      value={value}
      beforeMount={configureEnvMonaco}
      onMount={handleMount}
      theme="pi-studio-env"
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
        lineHeight: 22,
        lineNumbersMinChars: 3,
        padding: { top: 14, bottom: 14 },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        renderLineHighlight: 'line',
        wordWrap: 'off',
        tabSize: 2,
        folding: false,
        glyphMargin: false,
        lineDecorationsWidth: 8,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        parameterHints: { enabled: false },
        hover: { enabled: false },
        contextmenu: true,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: 'on',
        cursorBlinking: 'smooth',
        scrollbar: {
          verticalScrollbarSize: 9,
          horizontalScrollbarSize: 9,
          useShadows: false,
        },
      }}
    />
  )
}
