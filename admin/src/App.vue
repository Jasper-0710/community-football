<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createAdminApi } from './api'
import { createAdminAuth } from './auth'
import Competitions from './Competitions.vue'
import Teams from './Teams.vue'
import Registrations from './Registrations.vue'
let storage: Storage | undefined
try { storage = window.sessionStorage } catch { /* Private browsing may disallow storage. */ }
const auth = createAdminAuth(createAdminApi(import.meta.env.VITE_ADMIN_API_URL?.trim() || ''), storage)
const { status, account, message, busy } = auth
const username = ref(''), password = ref(''), showPassword = ref(false)
const activeView = ref<'account' | 'competitions' | 'teams' | 'registrations'>('account')
const dateText = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(value))
const expiresText = computed(() => account.value ? dateText(account.value.expiresAt) : '')
async function submit() {
  const submittedPassword = password.value
  password.value = ''; showPassword.value = false
  await auth.login(username.value.trim(), submittedPassword)
}
let interval: ReturnType<typeof setInterval> | undefined
function visibility() { if (document.visibilityState === 'visible' && status.value !== 'guest') void auth.check() }
onMounted(() => {
  void auth.initialize()
  interval = setInterval(() => { if (document.visibilityState === 'visible' && status.value !== 'guest') void auth.check() }, 60_000)
  document.addEventListener('visibilitychange', visibility)
})
onUnmounted(() => { clearInterval(interval); document.removeEventListener('visibilitychange', visibility); auth.dispose() })
</script>

<template>
  <div class="admin-app">
    <header class="topbar">
      <div class="brand"><img src="/brand.png" alt="" width="42" height="42" /><div><strong>中国社超</strong><span>上海赛区赛事平台</span></div></div>
      <span class="topbar-label">赛事管理后台</span>
    </header>
    <main v-if="status === 'guest'" class="login-layout">
      <section class="intro-panel" aria-labelledby="intro-title">
        <span class="intro-tag">上海赛区 · 赛事运营</span>
        <h1 id="intro-title">让赛事管理<br />有条不紊。</h1>
        <p>从球队报名到赛程赛果，<br />连接赛场内外的每一个环节。</p>
        <div class="pitch" aria-hidden="true"><i></i><b></b></div>
        <span class="intro-footer">中国社超上海赛区赛事平台</span>
      </section>
      <section class="login-card" aria-labelledby="login-title">
        <span class="eyebrow">欢迎回来</span><h2 id="login-title">管理员登录</h2>
        <p class="muted login-caption">使用平台管理员账号进入工作台。</p>
        <form @submit.prevent="submit">
          <label for="username">管理员账号</label>
          <input id="username" v-model="username" name="username" autocomplete="username" autocapitalize="none" :spellcheck="false" maxlength="32" required placeholder="请输入管理员账号" :disabled="busy" />
          <label for="password">登录密码</label>
          <div class="password-field"><input id="password" v-model="password" name="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" maxlength="128" required placeholder="请输入密码" :disabled="busy" /><button type="button" class="show-password" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button></div>
          <p v-if="message" class="notice" :class="{ success: message === '已退出登录。' }" role="status">{{ message }}</p>
          <button type="submit" class="primary-button" :disabled="busy">{{ busy ? '正在登录…' : '登录管理后台' }}<span aria-hidden="true">→</span></button>
        </form>
        <p class="login-footnote">仅限赛事运营人员使用。账号问题请联系平台负责人。</p>
      </section>
    </main>
    <main v-else-if="status === 'checking' || status === 'unavailable'" class="verification-panel">
      <span class="eyebrow">赛事管理后台</span>
      <h1>{{ status === 'checking' ? '正在确认登录状态…' : '暂时无法确认登录状态' }}</h1>
      <p class="muted" role="status">{{ message || '请稍候，正在读取账号信息。' }}</p>
      <div v-if="status === 'unavailable'" class="verification-actions"><button class="primary-button" :disabled="busy" @click="auth.check">重新连接</button><button class="secondary-button" :disabled="busy" @click="auth.logout">退出登录</button></div>
    </main>
    <main v-else class="workspace">
      <aside class="sidebar"><span class="eyebrow">管理工作台</span><button class="sidebar-link" :class="{ 'sidebar-active': activeView === 'account' }" :aria-current="activeView === 'account' ? 'page' : undefined" @click="activeView = 'account'">账号与访问</button><button class="sidebar-link" :class="{ 'sidebar-active': activeView === 'competitions' }" :aria-current="activeView === 'competitions' ? 'page' : undefined" @click="activeView = 'competitions'">赛事管理</button><button class="sidebar-link" :class="{ 'sidebar-active': activeView === 'teams' }" :aria-current="activeView === 'teams' ? 'page' : undefined" @click="activeView = 'teams'">球队档案</button><button class="sidebar-link" :class="{ 'sidebar-active': activeView === 'registrations' }" :aria-current="activeView === 'registrations' ? 'page' : undefined" @click="activeView = 'registrations'">报名审核</button><div v-for="item in ['赛程与赛果', '新闻与公告']" :key="item" class="sidebar-pending"><span>{{ item }}</span><small>待开放</small></div></aside>
      <section class="workspace-main">
        <Competitions v-if="activeView === 'competitions'" :auth="auth" />
        <Teams v-else-if="activeView === 'teams'" :auth="auth" />
        <Registrations v-else-if="activeView === 'registrations'" :auth="auth" />
        <template v-else>
        <div class="workspace-heading"><div><span class="eyebrow">赛事运营</span><h1>欢迎，{{ account?.admin.displayName }}</h1><p class="muted">管理员账号已通过验证。</p></div><button class="secondary-button logout-button" :disabled="busy" @click="auth.logout">{{ busy ? '处理中…' : '退出登录' }}</button></div>
        <p v-if="message" class="notice" role="status">{{ message }}</p>
        <div class="account-card"><div class="card-heading"><h2>账号与访问状态</h2><span class="status-badge">已登录</span></div><dl><div><dt>管理员账号</dt><dd>{{ account?.admin.username }}</dd></div><div><dt>账号身份</dt><dd>平台管理员</dd></div><div><dt>本次登录有效期</dt><dd>{{ expiresText }}</dd></div><div><dt>最近检查时间</dt><dd>{{ account ? dateText(account.serverTime) : '' }}</dd></div></dl><button class="secondary-button" :disabled="busy" @click="auth.check">{{ busy ? '正在检查…' : '检查登录状态' }}</button></div>
        <div class="upcoming-card"><h2>赛事工作区</h2><p class="muted">赛事管理、球队档案与报名审核已开放，可维护赛事并处理球队报名。</p><button class="secondary-button" @click="activeView = 'competitions'">进入赛事管理</button></div>
        </template>
      </section>
    </main>
    <footer class="page-footer">中国社超上海赛区赛事平台 · 赛事管理后台</footer>
  </div>
</template>
