if (!customElements.get('media-gallery')) {
  customElements.define(
    'media-gallery',
    class MediaGallery extends HTMLElement {
      constructor() {
        super();
        this.elements = {
          liveRegion: this.querySelector('[id^="GalleryStatus"]'),
          viewer: this.querySelector('[id^="GalleryViewer"]'),
          thumbnails: this.querySelector('[id^="GalleryThumbnails"]'),
        };
        this.mql = window.matchMedia('(min-width: 750px)');
        if (!this.elements.thumbnails) return;

        this.elements.viewer.addEventListener('slideChanged', debounce(this.onSlideChanged.bind(this), 500));
        this.elements.thumbnails.querySelectorAll('[data-target]').forEach((mediaToSwitch) => {
          mediaToSwitch
            .querySelector('button')
            .addEventListener('click', this.setActiveMedia.bind(this, mediaToSwitch.dataset.target, false));
        });
        if (this.dataset.desktopLayout.includes('thumbnail') && this.mql.matches) this.removeListSemantic();
      }

      onSlideChanged(event) {
        const thumbnail = this.elements.thumbnails.querySelector(
          `[data-target="${event.detail.currentElement.dataset.mediaId}"]`
        );
        this.setActiveThumbnail(thumbnail);
      }

      setActiveMedia(mediaId, prepend) {
        console.log('[MediaGallery] Clicked media ID:', mediaId);
        
        let activeMedia =
          this.elements.viewer.querySelector(`[data-media-id="${mediaId}"]`) ||
          this.elements.viewer.querySelector('[data-media-id]');
        if (!activeMedia) {
          console.warn('[MediaGallery] No slide found for media ID:', mediaId);
          return;
        }

        // Detect media type for logging
        const isVideo = !!activeMedia.querySelector('.deferred-media:not(product-model)');
        const isModel = !!activeMedia.querySelector('product-model');
        const mediaType = isModel ? 'model' : isVideo ? 'video/external_video' : 'image';
        console.log('[MediaGallery] Media type:', mediaType);

        // If the targeted media is hidden by our color filter, redirect to the first visible one.
        // EXCEPTION: never redirect away from video or model slides — they should always be clickable.
        if (activeMedia.classList.contains('g-color-filter-hidden') && !isVideo && !isModel) {
          const firstVisible = this.elements.viewer.querySelector('[data-media-id]:not(.g-color-filter-hidden)');
          if (firstVisible) {
            activeMedia = firstVisible;
            mediaId = activeMedia.getAttribute('data-media-id') || activeMedia.getAttribute('id');
            console.log('[MediaGallery] Redirected to first visible media ID:', mediaId);
          }
        }

         this.elements.viewer.querySelectorAll('[data-media-id]')
           .forEach((element) => element.classList.remove('is-active'));
         // Add active class to the new slide
         activeMedia?.classList?.add('is-active');
         // Ensure hidden filter class does not prevent rendering of video/model slides
         if (activeMedia?.classList?.contains('g-color-filter-hidden')) {
           activeMedia.classList.remove('g-color-filter-hidden');
         }
         console.log('[MediaGallery] Active slide classes:', activeMedia?.className);

        if (prepend) {
          activeMedia.parentElement.firstChild !== activeMedia && activeMedia.parentElement.prepend(activeMedia);

          if (this.elements.thumbnails) {
            const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
            activeThumbnail.parentElement.firstChild !== activeThumbnail && activeThumbnail.parentElement.prepend(activeThumbnail);
          }

          if (this.elements.viewer.slider) this.elements.viewer.resetPages();
        }

         this.preventStickyHeader();
         // Restore any previously modified modal-opener content on all slides
         this.elements.viewer.querySelectorAll('modal-opener').forEach((opener) => {
           if (opener.dataset.originalContent) {
             opener.innerHTML = opener.dataset.originalContent;
             delete opener.dataset.originalContent;
           }
         });
          // Inline video handling: replace modal opener with actual video content and autoplay
          const isVideoInline = !!activeMedia.querySelector('.deferred-media');
         if (isVideoInline) {
           const modalOpener = activeMedia.querySelector('modal-opener');
           const deferred = activeMedia.querySelector('.deferred-media');
           if (modalOpener && deferred) {
             // Unhide deferred media element
             deferred.classList.remove('g-color-filter-hidden');
             deferred.style.display = '';
             deferred.style.opacity = '';
             console.log('[MediaGallery] deferredMedia class:', deferred.className, 'style:', deferred.style.cssText);
             // Load the video/template content (may be synchronous)
             deferred.loadContent(false);
             // Preserve original markup for restoration later
             if (!modalOpener.dataset.originalContent) {
               modalOpener.dataset.originalContent = modalOpener.innerHTML;
             }
             // Inject the loaded video HTML
             modalOpener.innerHTML = deferred.innerHTML;
             const video = modalOpener.querySelector('video');
             if (video) {
               video.muted = true;
               video.playsInline = true;
               video.play().catch(err => console.warn('[MediaGallery] Inline video play error:', err));
             }
           }
         }

        // Ensure the slider scrolls to bring the active slide into view
        if (this.elements.viewer.slider) {
          this.elements.viewer.slider.scrollTo({ left: activeMedia.offsetLeft, behavior: 'smooth' });
          console.log('[MediaGallery] Slider scrollLeft after switch:', this.elements.viewer.slider.scrollLeft);
        }
        window.setTimeout(() => {
          if (!this.mql.matches || this.elements.thumbnails) {
            activeMedia.parentElement.scrollTo({ left: activeMedia.offsetLeft });
          }
          const activeMediaRect = activeMedia.getBoundingClientRect();
          // Don't scroll if the image is already in view
          if (activeMediaRect.top > -0.5) return;
          const top = activeMediaRect.top + window.scrollY;
          window.scrollTo({ top: top, behavior: 'smooth' });
        });
        console.log('[MediaGallery] Active media ID after switching:', mediaId);
        this.playActiveMedia(activeMedia);

        if (!this.elements.thumbnails) return;
        const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
        this.setActiveThumbnail(activeThumbnail);
        this.announceLiveRegion(activeMedia, activeThumbnail.dataset.mediaPosition);
      }

      setActiveThumbnail(thumbnail) {
        if (!this.elements.thumbnails || !thumbnail) return;

        this.elements.thumbnails
          .querySelectorAll('button')
          .forEach((element) => element.removeAttribute('aria-current'));
        thumbnail.querySelector('button').setAttribute('aria-current', true);
        if (this.elements.thumbnails.isSlideVisible(thumbnail, 10)) return;

        this.elements.thumbnails.slider.scrollTo({ left: thumbnail.offsetLeft });
      }

      announceLiveRegion(activeItem, position) {
        const image = activeItem.querySelector('.product__modal-opener--image img');
        if (!image) return;
        image.onload = () => {
          this.elements.liveRegion.setAttribute('aria-hidden', false);
          this.elements.liveRegion.innerHTML = window.accessibilityStrings.imageAvailable.replace('[index]', position);
          setTimeout(() => {
            this.elements.liveRegion.setAttribute('aria-hidden', true);
          }, 2000);
        };
        image.src = image.src;
      }

        playActiveMedia(activeItem) {
          // Pause any playing media first
          window.pauseAllMedia();
          // Video playback is now handled directly in setActiveMedia when a video slide becomes active.
          // No additional loading or playback needed here.
        }

      preventStickyHeader() {
        this.stickyHeader = this.stickyHeader || document.querySelector('sticky-header');
        if (!this.stickyHeader) return;
        this.stickyHeader.dispatchEvent(new Event('preventHeaderReveal'));
      }

      removeListSemantic() {
        if (!this.elements.viewer.slider) return;
        this.elements.viewer.slider.setAttribute('role', 'presentation');
        this.elements.viewer.sliderItems.forEach((slide) => slide.setAttribute('role', 'presentation'));
      }
    }
  );
}
