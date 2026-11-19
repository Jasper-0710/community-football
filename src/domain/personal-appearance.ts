import { themes, type PlatformForm } from './platform-settings'

export interface PersonalAppearance {
  theme: string
  customColor: string
  mode: 'platform' | 'light' | 'dark'
  radius: 'platform' | 'square' | 'soft' | 'round'
}

export class AppearanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'AppearanceError'
  }
}

export const defaultPersonalAppearance = (): PersonalAppearance => ({
  theme: 'platform', customColor: themes[0].color, mode: 'platform', radius: 'platform',
})

export function parsePersonalAppearance(value: unknown): PersonalAppearance {
  const v = value as Record<string, unknown> | null
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || Object.keys(v).length !== 4 || !['theme', 'customColor', 'mode', 'radius'].every(key => Object.prototype.hasOwnProperty.call(v, key))
    || typeof v.theme !== 'string' || !['platform', 'custom', ...themes.map(t => t.id)].includes(v.theme)
    || typeof v.customColor !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(v.customColor)
    || !['platform', 'light', 'dark'].includes(v.mode as string)
    || !['platform', 'square', 'soft', 'round'].includes(v.radius as string)) {
    throw new AppearanceError('INVALID_APPEARANCE', '请检查外观选项，自选主色需填写完整的六位十六进制颜色（如 #176390）。')
  }
  return { theme: v.theme, customColor: v.customColor.toLowerCase(), mode: v.mode as PersonalAppearance['mode'], radius: v.radius as PersonalAppearance['radius'] }
}

/** Personal choices never override the platform's name, navigation or destinations. */
export function resolveAppearance(platform: Omit<PlatformForm, 'navigation'> & { navigation: readonly PlatformForm['navigation'][number][] }, personal: PersonalAppearance): PlatformForm {
  return {
    ...platform,
    ...(personal.theme === 'platform' ? {} : { theme: personal.theme, customColor: personal.customColor }),
    mode: personal.mode === 'platform' ? platform.mode : personal.mode,
    radius: personal.radius === 'platform' ? platform.radius : personal.radius,
    navigation: platform.navigation.map(item => ({ ...item })),
  }
}

export function appearanceStorageKey(environment: string, endpoint: string, owner: string): string {
  return `community-football.appearance.v1:${JSON.stringify([environment, endpoint, owner])}`
}
