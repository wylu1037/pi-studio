'use client'

import { AvatarPresetPicker } from '@/components/avatar-preset-picker'
import { ChatAvatar, userAvatarPresets } from '@/components/chat-avatar'
import { Label, Panel } from '@/components/pi-ui'
import { useProfileSettings } from '@/components/use-profile-settings'

export function SettingsView() {
  const { userAvatar, setUserAvatar } = useProfileSettings()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-6 py-5">
        <Label>Settings</Label>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personalize how your messages appear in chat.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <Panel className="flex max-w-2xl flex-col gap-5 p-5">
          <div className="flex items-center gap-3">
            <ChatAvatar preset={userAvatar} role="user" className="size-11" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">User avatar</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Stored locally on this device.</p>
            </div>
          </div>
          <AvatarPresetPicker
            presets={userAvatarPresets}
            selected={userAvatar}
            role="user"
            onSelect={setUserAvatar}
          />
        </Panel>
      </div>
    </div>
  )
}
