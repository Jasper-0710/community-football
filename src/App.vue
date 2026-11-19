<script setup lang="ts">
import { onLaunch,onShow } from '@dcloudio/uni-app'
import { initializeWechatCloud } from '@/services/wechat-cloud'
import {usePlatformSettings} from '@/composables/usePlatformSettings'
import {useFavorites} from '@/composables/useFavorites'
function refreshSharedState() { void usePlatformSettings().refresh(); const favorites = useFavorites(); if (favorites.owner.value) void favorites.refresh() }
onShow(refreshSharedState)
onLaunch(() => {
  initializeWechatCloud()
  // #ifdef H5
  // uni-button renders a custom element in H5. Restore native-button keyboard behavior.
  document.addEventListener('keydown', event => {
    const target = event.target
    if ((event.key === 'Enter' || event.key === ' ') && target instanceof HTMLElement && target.classList.contains('ui-button') && !target.hasAttribute('disabled')) {
      event.preventDefault()
      target.click()
    }
  })
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshSharedState()})
  // #endif
})
</script>
<style lang="scss">@import './styles/global.scss';</style>
