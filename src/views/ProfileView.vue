<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Tournament, Tab } from '@/domain/types'
import type { AvatarUpload } from '@/domain/user'
import { MAX_NICKNAME_LENGTH } from '@/domain/user'
import { useFavorites } from '@/composables/useFavorites'
import { useUserProfile } from '@/composables/useUserProfile'
import { prepareAvatarUpload, profileErrorMessage } from '@/services/user-profile'
import AppIcon from '@/components/AppIcon.vue'
import TeamBadge from '@/components/TeamBadge.vue'

const props = defineProps<{ data: Tournament }>()
const emit = defineEmits<{ navigate: [tab: Tab, view?: string] }>()
const { favoriteIds, toggle } = useFavorites()
const favorites = computed(() => props.data.teams.filter(t => favoriteIds.value.includes(t.id)))
const { profile, loading, saving, refreshingAvatar, refreshAvatar, error, supported, login, save, logout } = useUserProfile()
const nickname = ref('')
const draftAvatar = ref<AvatarUpload>()
const draftAvatarPath = ref('')
const avatarLoading = ref(false)
const avatarError = ref('')
const avatarImageFailed = ref(false)
const headerAvatarFailed = ref(false)
const notice = ref('')
let autoAvatarRefreshAttempted = false
let avatarGeneration = 0
const avatarSource = computed(() => draftAvatarPath.value || profile.value?.avatarUrl || '')
const dirty = computed(() => !!profile.value && (nickname.value.trim() !== profile.value.nickname || (profile.value.avatarUploadEnabled && !!draftAvatar.value)))
const savedAvatarUnavailable = computed(() => !!profile.value?.avatarFileId && (!profile.value.avatarUrl || headerAvatarFailed.value || (!draftAvatarPath.value && avatarImageFailed.value)))
const nicknameLength = computed(() => Array.from(nickname.value).length)
const saveDisabled = computed(() => saving.value || !!(profile.value?.avatarUploadEnabled && (avatarLoading.value || avatarError.value)) || !dirty.value)

watch(profile, value => {
  ++avatarGeneration
  autoAvatarRefreshAttempted = false
  headerAvatarFailed.value = false
  avatarImageFailed.value = false
  nickname.value = value?.nickname || ''
  draftAvatar.value = undefined
  draftAvatarPath.value = ''
  avatarLoading.value = false
  avatarError.value = ''
})
watch(avatarSource, () => { avatarImageFailed.value = false })
watch(() => profile.value?.avatarUrl, () => { headerAvatarFailed.value = false })

async function reloadAvatar() {
  if (saving.value || refreshingAvatar.value) return
  autoAvatarRefreshAttempted = true
  if (await refreshAvatar()) {
    headerAvatarFailed.value = false
    if (!draftAvatarPath.value) avatarImageFailed.value = false
  }
}
function avatarFailed(target: 'header' | 'editor') {
  if (target === 'header') headerAvatarFailed.value = true
  else avatarImageFailed.value = true
  // A draft's local preview failing must not replace it with a saved avatar.
  if (target === 'editor' && draftAvatarPath.value) {
    avatarError.value = '选中的图片暂时无法预览，请重新选择或放弃修改。'
    return
  }
  if (!autoAvatarRefreshAttempted) void reloadAvatar()
}

function openMyTeam() { uni.navigateTo({ url: '/pages/team/manage' }) }
function openRegistrations() { uni.navigateTo({ url: '/pages/registration/mine' }) }
function open(id: string) { uni.navigateTo({ url: `/pages/team/detail?id=${id}` }) }
async function startLogin() { notice.value = ''; await login() }
function signOut() {
  ++avatarGeneration
  logout()
  notice.value = '已退出本机登录，云端个人资料仍然保留。'
}
async function selectAvatar(event: { detail?: { avatarUrl?: string } }) {
  if (!profile.value?.avatarUploadEnabled || saving.value) return
  const path = event.detail?.avatarUrl
  if (!path) return
  const request = ++avatarGeneration
  avatarLoading.value = true
  avatarError.value = ''
  draftAvatar.value = undefined
  draftAvatarPath.value = ''
  notice.value = ''
  try {
    const result = await prepareAvatarUpload(path)
    if (request !== avatarGeneration || !profile.value?.avatarUploadEnabled) return
    draftAvatar.value = result.upload
    draftAvatarPath.value = result.previewPath
  } catch (failure) {
    if (request === avatarGeneration) avatarError.value = profileErrorMessage(failure)
  } finally {
    if (request === avatarGeneration) avatarLoading.value = false
  }
}
async function saveProfile() {
  if (profile.value?.avatarUploadEnabled && (avatarLoading.value || avatarError.value)) return
  notice.value = ''
  if (await save(nickname.value, profile.value?.avatarUploadEnabled ? draftAvatar.value : undefined)) notice.value = '个人资料已保存。'
}
function discardChanges() {
  ++avatarGeneration
  nickname.value = profile.value?.nickname || ''
  draftAvatar.value = undefined
  draftAvatarPath.value = ''
  avatarError.value = ''
  avatarLoading.value = false
  error.value = ''
  notice.value = ''
}
onBeforeUnmount(() => { ++avatarGeneration })
</script>

<template>
  <view class="inner-page profile-page">
    <view class="profile-header">
      <view class="profile-pitch" aria-hidden="true"><view class="profile-pitch-circle" /></view>
      <view class="profile-header-top">
        <text class="profile-platform">中国社超 · 上海赛区</text>
        <text class="profile-status">{{ profile ? '已登录' : '游客体验' }}</text>
      </view>
      <view class="profile-identity">
        <view class="profile-avatar">
          <image v-if="profile?.avatarUrl && !headerAvatarFailed" :src="profile.avatarUrl" class="profile-avatar-image" mode="aspectFill" @error="avatarFailed('header')" />
          <AppIcon v-else name="user" tone="white" :size="34" />
        </view>
        <view class="profile-heading-copy">
          <text class="page-title">{{ profile ? `你好，${profile.nickname || '微信用户'}` : '我的赛事空间' }}</text>
          <text class="profile-welcome">{{ profile ? '欢迎回来，热爱从这里继续。' : '关注你的球队，找到自己的主场。' }}</text>
        </view>
      </view>
    </view>

    <view class="panel my-team-entry">
      <view><view class="my-team-entry-title"><AppIcon name="users" tone="green" :size="26"/><text class="section-title">我的球队</text></view><text class="section-subtitle">创建球队、维护资料和球员名单</text></view>
      <button class="ui-button primary-button" @click="openMyTeam">{{ profile ? '进入我的球队' : '登录并管理球队' }}<AppIcon name="arrow" tone="white" :size="18"/></button>
    </view>
    <view class="panel my-team-entry"><view><view class="my-team-entry-title"><AppIcon name="calendar" tone="green" :size="26"/><text class="section-title">我的报名</text></view><text class="section-subtitle">查看报名材料、审核结果与参赛进度</text></view><button class="ui-button outline-button" @click="openRegistrations">查看我的报名<AppIcon name="arrow" tone="green" :size="18"/></button></view>
    <view class="profile-panels">
    <view v-if="!profile" class="panel account-panel login-panel">
      <view class="login-caption"><AppIcon name="check" tone="green" :size="18" /><text>微信身份登录 · 无需账号密码</text></view>
      <text class="section-title">登录个人中心</text>
      <text class="account-description">登录后可设置昵称和头像；已保存的资料会随当前微信账号自动读取。</text>
      <text v-if="!supported" class="account-hint platform-hint">请在微信小程序中登录，网页预览暂不支持微信云登录。</text>
      <text v-if="loading" class="account-hint" role="status">正在确认微信身份并读取个人资料…</text>
      <text v-if="error" class="account-error" role="alert">{{ error }}</text>
      <text v-if="notice" class="account-hint" role="status">{{ notice }}</text>
      <view v-if="supported" class="account-actions login-actions">
        <button class="ui-button primary-button login-button" :class="{ 'is-disabled': loading }" hover-class="none" :disabled="loading" :loading="loading" @click="startLogin"><AppIcon v-if="!loading" name="user" tone="white" :size="21" /><text class="login-button-label">{{ loading ? '正在登录…' : error ? '重新登录' : '微信登录' }}</text><AppIcon v-if="!loading" name="arrow" tone="white" :size="20" /></button>
        <button v-if="loading" class="ui-button text-button" hover-class="none" @click="signOut">取消登录</button>
      </view>
      <text class="account-field-hint login-footnote">未设置头像时显示默认图案。微信头像需由你主动选择，平台不会自动获取。</text>
    </view>

    <view v-else class="panel account-panel">
      <view class="section-heading">
        <view class="account-heading-copy"><text class="section-title">个人资料</text><text class="section-subtitle">{{ profile.avatarUploadEnabled ? '昵称和头像修改后，点击保存生效' : '昵称修改后，点击保存生效' }}</text></view>
        <button class="ui-button text-button sign-out-button" hover-class="none" @click="signOut">退出登录</button>
      </view>
      <view class="avatar-card">
        <view class="avatar-card-heading"><text class="h3">个人头像</text><text class="avatar-state">{{ draftAvatar ? '待保存' : profile.avatarFileId ? '已设置' : '默认头像' }}</text></view>
        <!-- #ifdef MP-WEIXIN -->
        <button v-if="profile.avatarUploadEnabled" class="ui-button profile-avatar-field" hover-class="none" open-type="chooseAvatar" :disabled="saving || avatarLoading" aria-label="选择或更换个人头像" @chooseavatar="selectAvatar">
          <view class="avatar-select">
            <image v-if="avatarSource && !avatarImageFailed" :src="avatarSource" class="profile-avatar-image" mode="aspectFill" @error="avatarFailed('editor')" />
            <AppIcon v-else name="user" tone="green" :size="32" />
          </view>
          <view class="avatar-card-copy"><text class="h3">{{ avatarLoading ? '正在处理头像…' : draftAvatar ? '已选择新头像' : profile.avatarFileId ? '更换头像' : '选择头像' }}</text><text class="account-field-hint">{{ draftAvatar ? '点击下方“保存资料”后生效' : '选择微信头像或相册图片' }}</text></view>
          <AppIcon name="arrow" tone="green" :size="20" />
        </button>
        <!-- #endif -->
        <view v-if="!profile.avatarUploadEnabled" class="profile-avatar-field avatar-readonly">
          <view class="avatar-select"><AppIcon name="user" tone="green" :size="32" /></view>
          <view class="avatar-card-copy"><text class="h3">使用默认头像</text><text class="account-field-hint">头像上传待开通，昵称可正常保存。</text></view>
        </view>
        <text v-if="profile.avatarUploadEnabled" class="avatar-description">不选择时保留当前头像。支持 JPG、PNG，系统会自动压缩。</text>
        <view v-if="savedAvatarUnavailable" class="avatar-retry">
          <text class="account-field-hint">{{ refreshingAvatar ? '正在重新读取头像…' : '原头像暂时无法显示，已使用默认图案。' }}</text>
          <button class="ui-button text-button" hover-class="none" :disabled="refreshingAvatar || saving" @click="reloadAvatar">{{ refreshingAvatar ? '读取中…' : '重新加载' }}</button>
        </view>
      </view>
      <text v-if="profile.avatarUploadEnabled && avatarError" class="account-error" role="alert">{{ avatarError }}</text>
      <view class="nickname-field">
        <view class="nickname-label"><text class="h3">昵称</text><text class="muted small-text">{{ nicknameLength }}/{{ MAX_NICKNAME_LENGTH }}</text></view>
        <!-- #ifdef MP-WEIXIN -->
        <input v-model="nickname" class="nickname-input" type="nickname" :maxlength="MAX_NICKNAME_LENGTH" :disabled="saving" placeholder="请输入昵称（必填）" aria-label="昵称" />
        <!-- #endif -->
        <!-- #ifndef MP-WEIXIN -->
        <input v-model="nickname" class="nickname-input" type="text" :maxlength="MAX_NICKNAME_LENGTH" :disabled="saving" placeholder="请输入昵称（必填）" aria-label="昵称" />
        <!-- #endif -->
      </view>
      <text v-if="draftAvatar && !nickname.trim()" class="account-field-hint">请填写昵称，再保存头像和个人资料。</text>
      <text v-if="error" class="account-error" role="alert">{{ error }}</text>
      <text v-if="notice" class="account-success" role="status">{{ notice }}</text>
      <view class="account-actions">
        <button class="ui-button primary-button" :class="{ 'is-disabled': saveDisabled }" hover-class="none" :disabled="saveDisabled" :loading="saving" @click="saveProfile">{{ saving ? '保存中' : '保存资料' }}</button>
        <button v-if="(dirty || (profile.avatarUploadEnabled && (avatarError || avatarLoading))) && !saving" class="ui-button text-button" hover-class="none" @click="discardChanges">放弃修改</button>
      </view>
      <text class="account-field-hint account-footnote">退出只清除此设备的登录状态，不会删除云端资料。</text>
    </view>

    <view class="panel favorites-panel">
      <view class="section-heading">
        <view><text class="section-title">我的主队</text><text class="section-subtitle">关注 {{ favorites.length }} 支球队 · 仅保存在本机</text></view>
        <button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'tournament', 'teams')">发现球队<AppIcon name="arrow" :size="17" /></button>
      </view>
      <view v-if="!favorites.length" class="empty-state">
        <AppIcon name="heart" :size="40" tone="muted" /><text class="h3">你的主场，等你入座</text><text class="muted">关注一支社区球队，把热爱留在这里。</text>
        <button hover-class="none" role="button" tabindex="0" class="ui-button primary-button" @click="emit('navigate', 'tournament', 'teams')">认识参赛球队</button>
      </view>
      <view v-else>
        <view v-for="team in favorites" :key="team.id" class="favorite-row">
          <button hover-class="none" role="button" tabindex="0" class="ui-button" @click="open(team.id)"><TeamBadge :team="team" :size="40" /><view><text class="h3">{{ team.name }}</text><text class="muted small-text">{{ team.district }}</text></view></button>
          <button hover-class="none" role="button" tabindex="0" class="ui-button follow-button followed" @click="toggle(team.id)">取消关注</button>
        </view>
      </view>
    </view>
    </view>
    <view class="prototype-note">
      <AppIcon name="info" tone="green" :size="24" />
      <view><text class="h3">当前开放的功能</text><text class="prototype-note-description">赛事信息、微信登录与昵称已开放；赛程、球队与新闻仍为示例内容。建队与球员管理已开放，赛事报名将后续开放。关注记录仅保存在本机。</text></view>
    </view>
  </view>
</template>

<style scoped>
.profile-page { max-width: 940px; }
.profile-header { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 24px; padding: 26px 30px 30px; margin-bottom: 22px; background: #164d37; border: 1px solid #164d37; border-radius: 18px; overflow: hidden; color: #fff; }
.profile-header-top { position: relative; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.profile-platform { font-size: 14px; color: #d2e4d7; letter-spacing: .5px; }
.profile-status { padding: 4px 11px; border: 1px solid #6b957c; border-radius: 20px; font-size: 14px; color: #ecf5e5; white-space: nowrap; }
.profile-identity { position: relative; display: flex; align-items: center; gap: 18px; }
.profile-heading-copy { flex: 1; min-width: 0; }
.profile-header .profile-heading-copy .page-title { color: #fff; font-size: 28px; line-height: 1.4; letter-spacing: 0; margin: 0 0 8px; overflow-wrap: anywhere; }
.profile-welcome { display: block; color: #d2e4d7; font-size: 15px; line-height: 1.7; }
.profile-avatar { display: flex; align-items: center; justify-content: center; flex: none; width: 68px; height: 68px; border-radius: 20px; background: #396b50; border: 1px solid #7a9a77; overflow: hidden; }
.profile-avatar-image { width: 100%; height: 100%; display: block; }
.profile-pitch { position: absolute; width: 310px; height: 230px; right: -110px; top: 22px; border: 1px solid rgba(220,239,210,.14); border-radius: 12px; transform: rotate(-18deg); }
.profile-pitch::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; border-left: 1px solid rgba(220,239,210,.14); }
.profile-pitch-circle { position: absolute; width: 84px; height: 84px; border: 1px solid rgba(220,239,210,.14); border-radius: 50%; top: 72px; left: 111px; }
.profile-panels { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 22px; }
.account-panel, .favorites-panel { min-width: 0; padding: 26px; border-radius: 14px; }
.account-panel .section-heading { align-items: flex-start; gap: 12px; margin-bottom: 20px; }
.account-heading-copy { flex: 1; min-width: 0; }
.account-panel .section-title { font-size: 22px; letter-spacing: 0; }
.login-caption { display: flex; align-items: center; gap: 7px; color: #386548; font-size: 14px; margin-bottom: 17px; }
.login-panel .section-title { font-size: 25px; }
.account-description { display: block; margin-top: 10px; color: #627164; font-size: 16px; line-height: 1.85; }
.account-hint, .account-error, .account-success { display: block; margin-top: 14px; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.account-hint { color: var(--muted); padding: 14px 16px; background: #f3f7f1; border: 1px solid #d8e3d4; border-radius: 10px; }
.platform-hint { padding: 14px 16px; background: #f1f5ee; border: 1px solid #dfe8da; border-radius: 10px; color: #52684e; }
.account-error { color: #983927; background: #fff3ee; border-radius: 8px; padding: 10px 12px; }
.account-success { color: #20653e; background: #eff6eb; border-radius: 8px; padding: 10px 12px; }
.account-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 22px; }
.account-actions .primary-button { width: 100%; min-height: 50px; border-radius: 10px; font-size: 16px; font-weight: 600; }
.login-actions .login-button { justify-content: flex-start; padding: 0 18px; }
.login-button-label { flex: 1; text-align: center; }
.account-panel .primary-button.is-disabled { opacity: 1; color: #61725d; background: #e7ede3; border-color: #e7ede3; cursor: default; }
.account-panel .login-button.is-disabled { color: #fff; background: #396e50; border-color: #396e50; }
.account-panel .sign-out-button { min-height: 36px; padding: 0 10px; border: 1px solid #e1e8dc; border-radius: 8px; font-size: 14px; color: #64725f; }
.avatar-card { padding: 16px; background: #f6f9f3; border: 1px solid #dbe5d5; border-radius: 12px; }
.avatar-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.avatar-card-heading .h3 { font-size: 16px; }
.avatar-state { padding: 3px 9px; border-radius: 20px; background: #e7efe1; color: #43633e; font-size: 12px; line-height: 1.6; }
.profile-avatar-field { width: 100%; display: flex; align-items: center; gap: 14px; text-align: left; padding: 0; }
.avatar-card-copy { flex: 1; min-width: 0; }
.avatar-card-copy .h3 { font-size: 16px; }
.avatar-description { display: block; margin-top: 14px; color: #627164; font-size: 13px; line-height: 1.8; }
.avatar-retry { margin-top: 12px; padding-top: 10px; border-top: 1px solid #dbe5d5; }
.avatar-retry .text-button { min-height: 36px; font-size: 14px; color: #236144; }
.avatar-select { width: 64px; height: 64px; flex: none; border-radius: 18px; overflow: hidden; background: #edf2e7; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; }
.account-field-hint { display: block; color: var(--muted); font-size: 14px; line-height: 1.8; margin-top: 5px; }
.nickname-field { margin-top: 22px; }
.nickname-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; }
.nickname-label .h3 { font-size: 16px; }
.nickname-input { width: 100%; height: 50px; border: 1px solid #c7d5c2; border-radius: 10px; padding: 0 14px; color: var(--ink); background: #fafcf8; font-size: 16px; }
.nickname-input:focus-within { border-color: #1e6b48; background: #fff; }
.account-footnote { margin-top: 17px; }
.login-footnote { margin-top: 16px; }
.favorites-panel .empty-state { min-height: 230px; padding: 22px 0 8px; }
.favorites-panel .empty-state .h3 { font-size: 17px; }
.favorites-panel .empty-state .muted { font-size: 14px; }
.favorites-panel .primary-button { border-radius: 9px; font-size: 14px; }
.favorite-row { gap: 12px; flex-wrap: wrap; }
.prototype-note { background: #f0f3ec; border: 1px solid #d3dfce; border-radius: 12px; }
.prototype-note-description { color: #62715c; font-size: 14px; }
@media (max-width: 760px) {
  .profile-header { padding: 20px; gap: 22px; margin-bottom: 18px; border-radius: 16px; }
  .profile-platform { font-size: 14px; letter-spacing: 0; }
  .profile-identity { gap: 14px; align-items: flex-start; }
  .profile-avatar { width: 56px; height: 56px; border-radius: 17px; }
  .profile-header .profile-heading-copy .page-title { font-size: 22px; margin-bottom: 6px; }
  .profile-welcome { font-size: 14px; }
  .profile-panels { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .account-panel, .favorites-panel { padding: 23px 20px; }
  .account-panel .section-title, .favorites-panel .section-title { font-size: 21px; }
  .login-panel .section-title { font-size: 24px; }
  .favorites-panel .section-subtitle { font-size: 14px; }
  .prototype-note { margin-top: 18px; padding: 20px; }
}
</style>
