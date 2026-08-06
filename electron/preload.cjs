/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const { contextBridge, ipcRenderer } = require('electron')

const SELECT_ENV_FILE_CHANNEL = 'pi-studio:select-env-file'
const SELECT_SKILL_FOLDER_CHANNEL = 'pi-studio:select-skill-folder'

contextBridge.exposeInMainWorld('piStudio', {
  selectEnvFile: () => ipcRenderer.invoke(SELECT_ENV_FILE_CHANNEL),
  selectSkillFolder: () => ipcRenderer.invoke(SELECT_SKILL_FOLDER_CHANNEL),
})
