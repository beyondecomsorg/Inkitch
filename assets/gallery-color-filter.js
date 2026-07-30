/**
 * Product Gallery Variant Filter & Reorder
 *
 * Filters the product image gallery based on the currently selected variant
 * options, using the image Alt Text as the matching key.
 *
 * Alt Text conventions:
 *   - Format: {Value1}[+{Value2}][+{Value3}]-{Number}
 *     e.g. "Black-1", "Black+1-2", "Blue+800ml-3"
 *   - Values = one or more variant option VALUES, joined by "+"
 *   - {Number} after the last "-" = display order within that group, starting at 1
 *   - Blank alt text = "shared" image, valid for every variant
 *
 * Works for any number of product options (1, 2, or 3+) and any option names.
 * Videos are priority-classified and forced to position 3 (index 2) or the end.
 * Hidden items are disabled for screen readers and keyboard focus (aria-hidden & tabindex="-1").
 */

(function () {
  'use strict';

  // ─── CSS: hide / show classes ────────────────────────────────────────────────
  const STYLE_ID = 'gcf-styles';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.innerHTML = `
      .gcf-hidden {
        display: none !important; opacity: 0 !important; visibility: hidden !important;
        pointer-events: none !important; position: absolute !important;
        width: 0 !important; height: 0 !important; overflow: hidden !important;
        margin: 0 !important; padding: 0 !important; border: 0 !important;
      }
      .gcf-visible {
        opacity: 1 !important; visibility: visible !important;
        position: relative !important; pointer-events: auto !important;
      }
    `;
    document.head.appendChild(s);
  }

  // ─── Helper: Set element visibility & accessibility recursive attributes ──────
  function setElementVisibility(el, visible) {
    if (!el) return;
    if (visible) {
      el.classList.remove('gcf-hidden', 'g-color-filter-hidden', 'hidden');
      el.classList.add('gcf-visible', 'g-color-filter-visible');
      el.style.display = '';
      el.style.opacity = '1';
      el.removeAttribute('aria-hidden');
      el.removeAttribute('tabindex');

      // Enable inner focusable elements
      el.querySelectorAll('button, a, input, select, textarea, [tabindex]').forEach(item => {
        item.removeAttribute('tabindex');
      });
    } else {
      el.classList.remove('gcf-visible', 'g-color-filter-visible');
      el.classList.add('gcf-hidden', 'g-color-filter-hidden');
      el.style.display = 'none';
      el.style.opacity = '0';
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('tabindex', '-1');

      // Disable inner focusable elements
      el.querySelectorAll('button, a, input, select, textarea, [tabindex]').forEach(item => {
        item.setAttribute('tabindex', '-1');
      });
    }
  }

  // ─── Helper: Check if element is a video or 3D model ─────────────────────────
  function isVideoOrModel(el) {
    if (!el) return false;
    const matchesSelector = el.querySelector(
      '.media-type-video, .media-type-external-video, .media-type-external_video, .media-type-model, deferred-media, .deferred-media, product-model, [class*="--video"]'
    );
    const hasClass = el.classList.contains('product__media-item--full') || el.classList.contains('product-single__media-wrapper--full');
    return !!matchesSelector || hasClass;
  }

  // ─── Helper: Parse alt text according to conventions ────────────────────────
  function parseAlt(alt, productTitle) {
    const normTitle = productTitle ? productTitle.trim().toLowerCase() : '';
    const normAlt = alt ? alt.trim() : '';
    const normAltLower = normAlt.toLowerCase();

    // If blank/empty or matches product title (case-insensitive) -> SHARED
    if (!normAlt || normAltLower === normTitle) {
      return { type: 'SHARED', order: 9999, tokens: [] };
    }

    // Locate the last hyphen
    let orderNumber = 0;
    let tokensStr = normAlt;
    const lastDashIndex = normAlt.lastIndexOf('-');
    if (lastDashIndex !== -1) {
      const orderStr = normAlt.substring(lastDashIndex + 1).trim();
      const parsed = parseInt(orderStr, 10);
      if (!isNaN(parsed)) {
        orderNumber = parsed;
        tokensStr = normAlt.substring(0, lastDashIndex);
      } else {
        // Fallback: if text after last hyphen is non-numeric, treat entire string as option tokens and order = 0
        orderNumber = 0;
        tokensStr = normAlt;
      }
    }

    // Split on "+" and trim
    const tokens = tokensStr.split('+').map(t => t.trim().toLowerCase()).filter(Boolean);

    return {
      type: 'TAGGED',
      order: orderNumber,
      tokens: tokens
    };
  }

  // ─── Helper: Get explicit custom alt text attribute from a slide element ─────
  function getCustomAlt(slideElement) {
    if (!slideElement) return null;
    const candidates = [
      slideElement.getAttribute('data-variant-tag'),
      slideElement.getAttribute('data-alt'),
      slideElement.getAttribute('data-media-alt'),
    ];
    for (const v of candidates) {
      if (v && v.trim()) return v.trim();
    }
    const btn = slideElement.querySelector('button[data-variant-tag]');
    if (btn) {
      const v = btn.getAttribute('data-variant-tag');
      if (v && v.trim()) return v.trim();
    }
    return null;
  }

  // ─── Helper: Extract currently selected option values ────────────────────────
  function getSelectedOptionValues(variantObj) {
    let selected = [];
    if (variantObj && Array.isArray(variantObj.options)) {
      selected = variantObj.options;
    }

    // Fallback: Read from DOM inputs
    if (!selected || selected.length === 0) {
      const picker = document.querySelector('variant-radios, variant-selects, [data-variant-picker], .variant-picker, .product-form');
      if (picker) {
        const optionContainers = Array.from(picker.querySelectorAll('.product-form__input'));
        if (optionContainers.length > 0) {
          selected = optionContainers.map(container => {
            const input = container.querySelector('input:checked, select');
            if (!input) return '';
            if (input.tagName === 'SELECT') {
              return input.value;
            }
            return input.value || input.getAttribute('data-value') || '';
          }).filter(Boolean);
        }
      }
    }

    // Fallback: ShopifyAnalytics
    if (!selected || selected.length === 0) {
      if (window.ShopifyAnalytics?.meta?.selectedVariant?.options) {
        selected = window.ShopifyAnalytics.meta.selectedVariant.options;
      }
    }

    return selected.map(v => String(v).trim().toLowerCase()).filter(Boolean);
  }

  // ─── Helper: Sync reordering & visibility to the Zoom Product Modal ──────────
  function syncProductModal(visibleItems) {
    const modal = document.querySelector('product-modal, .product-media-modal');
    if (!modal) return;
    const contentWrapper = modal.querySelector('.product-media-modal__content');
    if (!contentWrapper) return;

    const modalItems = Array.from(contentWrapper.children);
    const itemsMap = {};
    modalItems.forEach(el => {
      const id = el.getAttribute('data-media-id');
      if (id) {
        itemsMap[id] = el;
      }
    });

    // Hide all items first
    modalItems.forEach(el => {
      setElementVisibility(el, false);
    });

    // Reorder and show in the modal
    visibleItems.forEach(item => {
      const shopifyId = item.shopifyId;
      const el = itemsMap[shopifyId];
      if (el) {
        setElementVisibility(el, true);
        contentWrapper.appendChild(el);
      }
    });
  }

  // ─── Helper: Insert videos at position 3 (index 2) ───────────────────────────
  function insertVideosAtPosition3(baseImageList, videos) {
    if (!videos || videos.length === 0) return [...baseImageList];
    const list = [...baseImageList];
    const insertIdx = Math.min(2, list.length);
    list.splice(insertIdx, 0, ...videos);
    return list;
  }

  // ─── GalleryFilterInstance Class ─────────────────────────────────────────────
  class GalleryFilterInstance {
    constructor(container) {
      this.container = container;
      this.mediaCache = [];
      this._buildCache();
      this.update();
    }

    // Cache the list of slide and thumbnail elements
    _buildCache() {
      const mainList =
        this.container.querySelector(
          '.product__media-list, .product-single__photos, .product__gallery, ul.slider'
        ) || this.container;

      let slides = Array.from(
        mainList.querySelectorAll(
          '.product__media-item, .product-single__media-wrapper, [data-media-id], .slider__slide'
        )
      ).filter((el, i, arr) => arr.indexOf(el) === i);

      // Exclude nested duplicates
      slides = slides.filter(el => !slides.some(other => other !== el && other.contains(el)));

      const thumbContainer =
        this.container.querySelector('[id^="GalleryThumbnails"], .thumbnail-list') ||
        document.querySelector('[id^="GalleryThumbnails"], .thumbnail-list');

      let thumbs = [];
      if (thumbContainer) {
        thumbs = Array.from(
          thumbContainer.querySelectorAll('.thumbnail-list__item, [data-target], .thumbnail-item')
        ).filter((el, i, arr) => arr.indexOf(el) === i);
        thumbs = thumbs.filter(el => !thumbs.some(other => other !== el && other.contains(el)));
      }

      this.mainList = mainList;
      this.thumbContainer = thumbContainer;
      this.productTitle = this.container.getAttribute('data-product-title') || '';

      this.mediaCache = slides.map((el, idx) => {
        const shopifyId = el.getAttribute('data-shopify-media-id');
        const mediaId   = el.getAttribute('data-media-id') || el.getAttribute('id') || '';
        const cleanId   = mediaId.replace('Slide-', '').replace('MediaGallery-', '');

        const customAlt = getCustomAlt(el);

        // Find associated thumbnail
        const thumb = thumbs.find(t => {
          const tId = t.getAttribute('data-shopify-media-id');
          if (shopifyId && tId && shopifyId === tId) return true;
          const target =
            t.getAttribute('data-target') ||
            t.getAttribute('data-media-id') ||
            t.querySelector('button')?.getAttribute('data-target') || '';
          return cleanId && target.includes(cleanId);
        }) || (idx < thumbs.length ? thumbs[idx] : null);

        return { el, thumb, idx, shopifyId, mediaId, customAlt };
      });
    }

    // Main filter, sort, reorder, and render logic
    update(variantObj = null) {
      this._buildCache(); // Rebuild cache dynamically in case DOM changes

      const currentSelection = getSelectedOptionValues(variantObj);

      const videos = [];
      const taggedImages = [];
      const sharedImages = [];

      // 1. Prioritize and separate media by type and alt-text classification
      this.mediaCache.forEach(item => {
        if (isVideoOrModel(item.el)) {
          videos.push(item);
        } else {
          const parsed = parseAlt(item.customAlt, this.productTitle);
          item.parsed = parsed;
          if (parsed.type === 'SHARED') {
            sharedImages.push(item);
          } else {
            taggedImages.push(item);
          }
        }
      });

      // 2. Perform matching for tagged images
      const matchedTaggedImages = taggedImages.filter(item => {
        const tokens = item.parsed.tokens;
        if (tokens.length === 0) return false;
        return tokens.every(token => {
          return currentSelection.some(optValue => optValue === token);
        });
      });

      // 3. Sort matched tagged images ascending by order number (keep original DOM order on tie)
      matchedTaggedImages.sort((a, b) => {
        const diff = a.parsed.order - b.parsed.order;
        return diff !== 0 ? diff : a.idx - b.idx;
      });

      // Sort shared images by original DOM order
      sharedImages.sort((a, b) => a.idx - b.idx);

      // 4. Assemble the sorted list
      let visible = [];
      if (matchedTaggedImages.length > 0) {
        const withVideos = insertVideosAtPosition3(matchedTaggedImages, videos);
        visible = [...withVideos, ...sharedImages];
      } else {
        // Fallback 1: Show videos + shared images only (in original upload order)
        if (sharedImages.length > 0) {
          visible = insertVideosAtPosition3(sharedImages, videos);
        } else {
          // Fallback 2: Show everything (all images in DOM order, videos pinned to pos 3)
          const allImages = this.mediaCache.filter(item => !isVideoOrModel(item.el));
          visible = insertVideosAtPosition3(allImages, videos);
        }
      }

      console.log('[GalleryFilter] Selected values:', currentSelection);
      console.log('[GalleryFilter] Sorted Visible IDs:', visible.map(i => i.shopifyId || i.mediaId));

      // 5. Hide and show DOM elements with appropriate accessibility attributes
      const visibleSet = new Set(visible.map(item => item.el));

      this.mediaCache.forEach(item => {
        const isVisible = visibleSet.has(item.el);
        setElementVisibility(item.el, isVisible);
        if (item.thumb) {
          setElementVisibility(item.thumb, isVisible);
        }
      });

      // 6. Non-destructively reorder the visible elements in the DOM
      visible.forEach(item => {
        if (item.el && this.mainList) {
          this.mainList.appendChild(item.el);
        }
        if (item.thumb && this.thumbContainer) {
          const list = this.thumbContainer.querySelector('ul') || this.thumbContainer;
          list.appendChild(item.thumb);
        }
      });

      // 7. Sync reordering and visibility with the Zoom Product Modal
      syncProductModal(visible);

      // 8. Re-calculate SliderComponent pages and scroll position boundaries
      this.container.elements?.viewer?.resetPages?.();
      this.container.elements?.thumbnails?.resetPages?.();

      // 9. Reset position and activate the first slide of the filtered set
      if (visible.length > 0) {
        const first = visible[0];
        const mId = first.mediaId || first.el.getAttribute('data-media-id');

        if (typeof this.container.setActiveMedia === 'function' && mId) {
          this.container.setActiveMedia(mId, false);
        } else {
          this.mediaCache.forEach(i => {
            i.el?.classList.remove('is-active', 'active');
            if (i.thumb) {
              i.thumb.classList.remove('is-active', 'active');
              i.thumb.querySelector('button')?.removeAttribute('aria-current');
            }
          });
          first.el?.classList.add('is-active');
          if (first.thumb) {
            first.thumb.classList.add('is-active');
            first.thumb.querySelector('button')?.setAttribute('aria-current', 'true');
          }
        }

        // Scroll back to the start of the sliders
        this.mainList?.scrollTo({ left: 0 });
        if (this.mainList) this.mainList.scrollLeft = 0;
        const tl = this.thumbContainer?.querySelector('ul') || this.thumbContainer;
        tl?.scrollTo({ left: 0 });
        if (tl) tl.scrollLeft = 0;

        // Synchronize display counters
        const total = this.container.querySelector('.slider-counter--total');
        const current = this.container.querySelector('.slider-counter--current');
        if (total) total.textContent = visible.length;
        if (current) current.textContent = '1';
      }
    }
  }

  // ─── Instance Registry ───────────────────────────────────────────────────────
  const instances = new WeakMap();

  function getOrCreate(container) {
    if (!instances.has(container)) {
      instances.set(container, new GalleryFilterInstance(container));
    }
    return instances.get(container);
  }

  function initGalleries() {
    document
      .querySelectorAll('media-gallery, [id^="MediaGallery-"], .product__gallery, .product-single__photos')
      .forEach(c => getOrCreate(c));
  }

  function updateAll(firstArg = null, secondArg = null) {
    let variantObj = null;
    if (firstArg && typeof firstArg === 'object' && firstArg.options) {
      variantObj = firstArg;
    } else if (secondArg && typeof secondArg === 'object' && secondArg.options) {
      variantObj = secondArg;
    }

    document
      .querySelectorAll('media-gallery, [id^="MediaGallery-"], .product__gallery, .product-single__photos')
      .forEach(c => getOrCreate(c).update(variantObj));
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────
  function attachListeners() {
    // Dawn PubSub system
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      if (PUB_SUB_EVENTS.variantChange) {
        subscribe(PUB_SUB_EVENTS.variantChange, e => updateAll(e.data?.variant));
      }
      if (PUB_SUB_EVENTS.optionValueSelectionChange) {
        subscribe(PUB_SUB_EVENTS.optionValueSelectionChange, () => setTimeout(() => updateAll(), 50));
      }
    }

    // Custom theme events
    document.addEventListener('variant:change', e => updateAll(e.detail?.variant || null));
    document.addEventListener('variant-change', e => updateAll(e.detail?.variant || null));
    document.addEventListener('option:change', () => updateAll());

    // Native inputs inside variant pickers
    document.addEventListener('change', e => {
      if (
        e.target.matches('input[type="radio"], select, input[type="checkbox"]') &&
        e.target.closest(
          'variant-radios, variant-selects, [data-variant-picker], .variant-picker, .product-form'
        )
      ) {
        setTimeout(() => updateAll(), 50);
      }
    });

    // Swatches and custom buttons
    document.addEventListener('click', e => {
      const btn = e.target.closest('button, label, .swatch, input');
      if (
        btn &&
        btn.closest(
          'variant-radios, variant-selects, [data-variant-picker], .variant-picker, .product-form'
        )
      ) {
        setTimeout(() => updateAll(), 10);
        setTimeout(() => updateAll(), 100);
      }
    });

    // popstate listener for browser back/forward variant URL synchronization
    window.addEventListener('popstate', () => {
      setTimeout(() => updateAll(), 50);
    });

    // MutationObserver on legend elements/selected value texts
    document.querySelectorAll('[data-selected-value], legend').forEach(el => {
      new MutationObserver(() => updateAll()).observe(el, {
        childList: true, characterData: true, subtree: true,
      });
    });
  }

  // ─── Boot execution ──────────────────────────────────────────────────────────
  function boot() {
    initGalleries();
    attachListeners();
    setTimeout(() => updateAll(), 50);
    setTimeout(() => updateAll(), 200);
    setTimeout(() => updateAll(), 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('load', () => {
    setTimeout(() => updateAll(), 50);
  });

  // Public Interface API
  window.ProductGalleryColorFilter = { init: initGalleries, update: updateAll };
})();
