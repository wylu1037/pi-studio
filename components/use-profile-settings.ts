'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_USER_AVATAR,
  parseStoredProfile,
  USER_PROFILE_CHANGE_EVENT,
  USER_PROFILE_STORAGE_KEY,
  type UserAvatarPresetId,
} from '@/lib/profile-settings'

export function useProfileSettings() {
  const [userAvatar, setUserAvatarState] = useState<UserAvatarPresetId>(DEFAULT_USER_AVATAR)

  useEffect(() => {
    const read = () => {
      setUserAvatarState(
        parseStoredProfile(window.localStorage.getItem(USER_PROFILE_STORAGE_KEY)).avatar,
      )
    }
    read()
    window.addEventListener('storage', read)
    window.addEventListener(USER_PROFILE_CHANGE_EVENT, read)
    return () => {
      window.removeEventListener('storage', read)
      window.removeEventListener(USER_PROFILE_CHANGE_EVENT, read)
    }
  }, [])

  const setUserAvatar = useCallback((avatar: UserAvatarPresetId) => {
    window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify({ avatar }))
    setUserAvatarState(avatar)
    window.dispatchEvent(new Event(USER_PROFILE_CHANGE_EVENT))
  }, [])

  return { userAvatar, setUserAvatar }
}
