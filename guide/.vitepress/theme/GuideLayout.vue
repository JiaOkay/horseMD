<script setup>
import DefaultTheme from 'vitepress/theme'
import { onBeforeUnmount, onMounted, ref } from 'vue'

const { Layout } = DefaultTheme
const zoomedImage = ref(null)

function onDocumentClick(event) {
  const image = event.target.closest?.('.vp-doc img:not(.no-zoom)')
  if (!image) return
  zoomedImage.value = {
    src: image.currentSrc || image.src,
    alt: image.alt || '教程图片'
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') zoomedImage.value = null
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Layout />
  <Teleport to="body">
    <div v-if="zoomedImage" class="hm-lightbox" role="dialog" aria-modal="true" :aria-label="zoomedImage.alt" @click.self="zoomedImage = null">
      <button class="hm-lightbox-close" type="button" aria-label="关闭图片预览" @click="zoomedImage = null">×</button>
      <img :src="zoomedImage.src" :alt="zoomedImage.alt" />
    </div>
  </Teleport>
</template>
