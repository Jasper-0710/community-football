<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useUserProfile } from '@/composables/useUserProfile'
import { usePersonalAppearance } from '@/composables/usePersonalAppearance'
import { usePlatformSettings } from '@/composables/usePlatformSettings'
import { defaultPersonalAppearance, resolveAppearance, type PersonalAppearance } from '@/domain/personal-appearance'
import { themes, themeTokens } from '@/domain/platform-settings'

const { profile } = useUserProfile()
const appearance = usePersonalAppearance(), platform = usePlatformSettings()
const draft = ref<PersonalAppearance>(defaultPersonalAppearance()), error = ref(''), notice = ref('')
let editingScope = 0
function readSaved() {
  draft.value = { ...appearance.form.value }
  editingScope = appearance.scopeVersion.value
  error.value = ''; notice.value = ''
}
watch(appearance.scopeVersion, readSaved, { immediate: true, flush: 'sync' })
const pendingForm = computed(() => ({
  ...draft.value,
  customColor: draft.value.theme === 'custom' ? draft.value.customColor : appearance.form.value.customColor,
}))
const dirty = computed(() => JSON.stringify(pendingForm.value) !== JSON.stringify(appearance.form.value))
const previewForm = computed(() => resolveAppearance(platform.settings.value.form, draft.value))
const previewTokens = computed(() => themeTokens(previewForm.value))
const modeOptions = [{ id: 'platform', label: '跟随平台明暗' }, { id: 'light', label: '浅色' }, { id: 'dark', label: '深色' }] as const
const radiusOptions = [{ id: 'platform', label: '跟随平台圆角' }, { id: 'square', label: '直角' }, { id: 'soft', label: '柔和' }, { id: 'round', label: '圆润' }] as const
function allPlatform() { draft.value = defaultPersonalAppearance(); error.value = ''; notice.value = '' }
function save() {
  error.value = ''; notice.value = ''
  try {
    appearance.save(pendingForm.value, editingScope)
    draft.value = { ...appearance.form.value }
    notice.value = '外观已保存并生效。'
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '保存失败，请重试。' }
}
function back() { uni.reLaunch({ url: '/pages/index/index?tab=profile' }) }
</script>

<template>
  <AppShell active="profile" detail live>
    <view class="inner-page appearance-page">
      <button role="button" tabindex="0" hover-class="none" class="ui-button text-button" @click="back">← 返回个人中心</button>
      <view class="appearance-heading">
        <text class="eyebrow">我的偏好</text><text class="page-title">外观设置</text>
        <text class="page-description">为你的主场换个样子，也可以让平台替你选。</text>
      </view>
      <view class="appearance-scope" role="status">
        <AppIcon name="user" tone="green" :size="20" />
        <text>{{ profile ? `当前账号：${profile.nickname || '微信用户'}。设置仅保存在本机，退出后切回游客外观。` : '当前为游客。设置仅保存在本机，登录后使用该账号自己的外观。' }}</text>
      </view>
      <view v-if="appearance.readError.value" class="appearance-message" role="alert"><text>{{ appearance.readError.value }}</text></view>
      <view class="appearance-layout">
        <view class="appearance-controls">
          <view class="panel appearance-section">
            <view class="appearance-section-heading"><text class="section-title">主题配色</text><text class="section-subtitle">个人配色优先生效，不影响其他用户。</text></view>
            <button role="button" tabindex="0" hover-class="none" class="ui-button appearance-follow" aria-label="跟随平台配色" :aria-pressed="draft.theme === 'platform'" @click="draft.theme = 'platform'">跟随平台配色<text>{{ draft.theme === 'platform' ? '已选择' : '使用平台最新配色' }}</text></button>
            <view class="appearance-theme-grid">
              <button v-for="theme in themes" :id="`appearance-theme-${theme.id}`" :key="theme.id" role="button" tabindex="0" hover-class="none" class="ui-button appearance-theme" :aria-label="theme.name" :aria-pressed="draft.theme === theme.id" @click="draft.theme = theme.id">
                <view class="appearance-swatch" :style="{ background: theme.color }"><text v-if="draft.theme === theme.id">✓</text></view><text>{{ theme.name }}</text>
              </button>
            </view>
            <button role="button" tabindex="0" hover-class="none" class="ui-button appearance-follow" aria-label="自选主色" :aria-pressed="draft.theme === 'custom'" @click="draft.theme = 'custom'">自选主色<text>{{ draft.theme === 'custom' ? '已选择' : '填写颜色代码' }}</text></button>
            <view v-if="draft.theme === 'custom'" class="appearance-custom">
              <label for="appearance-color">六位十六进制颜色</label>
              <input id="appearance-color" v-model="draft.customColor" aria-label="自选主色颜色代码" maxlength="7" placeholder="#176390" :adjust-position="true" />
              <text class="section-subtitle">输入 # 和六位数字或字母 A–F，例如 #176390。</text>
            </view>
          </view>
          <view class="panel appearance-section">
            <view class="appearance-section-heading"><text class="section-title">明暗模式</text><text class="section-subtitle">“跟随平台”使用后台当前设置。</text></view>
            <view class="appearance-options">
              <button v-for="option in modeOptions" :id="`appearance-mode-${option.id}`" :key="option.id" role="button" tabindex="0" hover-class="none" class="ui-button appearance-option" :aria-label="option.label" :aria-pressed="draft.mode === option.id" @click="draft.mode = option.id">{{ option.label }}</button>
            </view>
          </view>
          <view class="panel appearance-section">
            <view class="appearance-section-heading"><text class="section-title">圆角风格</text><text class="section-subtitle">调整卡片和主要按钮的边角。</text></view>
            <view class="appearance-options">
              <button v-for="option in radiusOptions" :id="`appearance-radius-${option.id}`" :key="option.id" role="button" tabindex="0" hover-class="none" class="ui-button appearance-option" :aria-label="option.label" :aria-pressed="draft.radius === option.id" @click="draft.radius = option.id">{{ option.label }}</button>
            </view>
          </view>
        </view>
        <view class="appearance-preview-wrap">
          <view class="appearance-preview-label"><text class="section-title">效果预览</text><text class="section-subtitle">{{ dirty ? '尚未保存，仅在此处预览' : '当前已保存的外观' }}</text></view>
          <view class="appearance-preview" :style="previewTokens" :class="{ 'appearance-preview-dark': previewForm.mode === 'dark' }" aria-label="个人外观预览">
            <view class="appearance-preview-header"><image src="/static/brand.png" mode="aspectFit" /><view><text class="appearance-preview-title">{{ previewForm.title }}</text><text class="appearance-preview-subtitle">{{ previewForm.subtitle }}</text></view></view>
            <view class="appearance-preview-body">
              <view class="appearance-preview-hero"><text>社区足球，每周相见</text><text>每一份热爱，都值得上场。</text></view>
              <view class="appearance-preview-card"><text>周末社区杯</text><text>赛程、比分与球队动态，随时掌握。</text><view class="appearance-preview-action">查看赛事<AppIcon name="arrow" :preserve-tone="true" :tone="previewTokens['--on-accent'] === '#ffffff' ? 'white' : 'ink'" :size="18" /></view></view>
            </view>
            <view class="appearance-preview-nav"><view v-for="(item, index) in previewForm.navigation" :key="item.id"><view :class="{ 'appearance-preview-active': index === 0, 'navigation-icon-black': index === 0 && previewTokens['--on-accent'] === '#000000' }"><AppIcon :name="item.icon" :preserve-tone="true" :tone="index === 0 ? (previewTokens['--on-accent'] === '#ffffff' ? 'white' : 'ink') : (previewForm.mode === 'dark' ? 'white' : 'muted')" :size="20" /></view><text>{{ item.label }}</text></view></view>
          </view>
          <text class="appearance-preview-footnote">名称与导航由平台统一管理。未单独选择的项目会继续跟随平台更新。</text>
        </view>
      </view>
      <view class="panel appearance-save-panel">
        <text class="section-subtitle">选择后点击保存才会应用。返回或放弃修改不会改变已保存的外观。</text>
        <view v-if="error" class="appearance-message appearance-error" role="alert"><text>{{ error }}</text></view>
        <view v-if="notice && !dirty" class="appearance-message" role="status"><text>{{ notice }}</text></view>
        <view class="appearance-actions">
          <button id="appearance-save" role="button" tabindex="0" hover-class="none" class="ui-button primary-button" :disabled="!dirty" @click="save">保存外观设置</button>
          <button role="button" tabindex="0" hover-class="none" class="ui-button outline-button" :disabled="!dirty" @click="readSaved">放弃修改</button>
          <button role="button" tabindex="0" hover-class="none" class="ui-button text-button" @click="allPlatform">全部跟随平台</button>
        </view>
      </view>
    </view>
  </AppShell>
</template>
