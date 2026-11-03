<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { initializeWechatCloud } from '@/services/wechat-cloud'
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
  // #endif
})
</script>
<style lang="scss">@import './styles/global.scss';</style>
