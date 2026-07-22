/**
 * Product Gallery Color Filter & Variant Sync
 * Synchronizes product gallery images with selected Color variant using:
 * 1. Shopify product.media variants array (data-product-media-map)
 * 2. Shopify native variant.featured_media.id / variant.featured_image.id
 * 3. Color-Number pattern Alt text matching (e.g., "Green-1", "Green 2", "green_3", "Green")
 *    - Matching color images appear FIRST in numeric order (Green-1 before Green-2)
 *    - Shared / untagged / general description images appear SECOND in product media order
 *    - Other color images (and their thumbnails) are hidden instantly
 * 4. Ignoring Pack / Size / non-color option changes
 */

(function () {
  'use strict';

  // Inject CSS transition styles
  const styleId = 'gallery-color-filter-styles';
  if (!document.getElementById(styleId)) {
    const styleTag = document.createElement('style');
    styleTag.id = styleId;
    styleTag.innerHTML = `
      .g-color-filter-transition {
        transition: opacity 200ms ease-in-out !important;
      }
      .g-color-filter-hidden {
        opacity: 0 !important;
        visibility: hidden !important;
        position: absolute !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        display: none !important;
      }
      .g-color-filter-visible {
        opacity: 1 !important;
        visibility: visible !important;
        position: relative !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(styleTag);
  }

  // Regex to identify Color option names (ignoring Pack, Size, Quantity, etc.)
  const COLOR_OPTION_REGEX = /^(colou?r|farbe|couleur|coloris|colore|cor)$/i;

  function normalizeString(str) {
    if (!str) return '';
    return String(str).trim().toLowerCase();
  }

  function getMediaAltText(element) {
    if (!element) return '';

    // 1. Check data-variant-tag / data-alt / data-media-alt
    let alt = element.getAttribute('data-variant-tag') ||
              element.getAttribute('data-alt') ||
              element.getAttribute('data-media-alt');
    if (alt !== null && alt !== undefined && alt.trim() !== '') {
      return alt.trim();
    }

    // 2. Check inner button data-variant-tag (Dawn thumbnails)
    const button = element.querySelector('button[data-variant-tag]');
    if (button) {
      alt = button.getAttribute('data-variant-tag');
      if (alt !== null && alt !== undefined && alt.trim() !== '') return alt.trim();
    }

    // 3. Check inner img alt
    const img = element.querySelector('img');
    if (img) {
      alt = img.getAttribute('alt');
      if (alt !== null && alt !== undefined && alt.trim() !== '') return alt.trim();
    }

    return '';
  }

  function parseAltTag(altText, availableColors = []) {
    if (!altText || !altText.trim()) {
      return { isShared: true, color: null, number: Infinity };
    }

    const cleanAlt = altText.trim();
    const match = cleanAlt.match(/^(.+?)[\s_-]*(\d+)?$/i);

    if (match) {
      const extractedColor = match[1].trim().toLowerCase();
      const extractedNumber = match[2] ? parseInt(match[2], 10) : 1;

      if (availableColors.length > 0) {
        const matchedColor = availableColors.find(c => c.toLowerCase() === extractedColor);
        if (matchedColor) {
          return { isShared: false, color: matchedColor.toLowerCase(), number: extractedNumber };
        }
      } else {
        return { isShared: false, color: extractedColor, number: extractedNumber };
      }
    }

    return { isShared: true, color: null, number: Infinity };
  }

  class GalleryColorFilterInstance {
    constructor(galleryContainer) {
      this.container = galleryContainer;
      this.currentColor = null;
      this.currentFeaturedMediaId = null;
      this.initCache();
      this.update();
    }

    initCache() {
      // Find main media list & items
      const mainList = this.container.querySelector('.product__media-list, .product-single__photos, .product__gallery, .product-slideshow, ul.slider') ||
                       this.container;
      
      const mainItems = Array.from(mainList.querySelectorAll('.product__media-item, .product-single__media-wrapper, .product-gallery__media, [data-media-id], .slider__slide, .swiper-slide, .slick-slide'))
        .filter((item, index, self) => self.indexOf(item) === index);

      // Find thumbnail list & items
      const thumbnailContainer = this.container.querySelector('.thumbnail-list, .product__thumb-item, .product-gallery__thumbnails, [id^="GalleryThumbnails"]') ||
                                 document.querySelector('.thumbnail-list, [id^="GalleryThumbnails"]');
      let thumbnailItems = [];
      if (thumbnailContainer) {
        thumbnailItems = Array.from(thumbnailContainer.querySelectorAll('.thumbnail-list__item, .product__thumb-item, [data-target], .thumbnail-item'));
      }

      this.mainList = mainList;
      this.thumbnailContainer = thumbnailContainer;

      // Cache items with original relative index and explicit data-shopify-media-id
      this.mediaCache = mainItems.map((element, index) => {
        const altText = getMediaAltText(element);
        const shopifyMediaId = element.getAttribute('data-shopify-media-id');
        const mediaId = element.getAttribute('data-media-id') || element.getAttribute('id');

        // Match thumbnail by data-shopify-media-id or data-target
        let thumbnailElement = null;
        if (thumbnailItems.length > 0) {
          thumbnailElement = thumbnailItems.find(thumb => {
            const thumbShopifyId = thumb.getAttribute('data-shopify-media-id');
            if (shopifyMediaId && thumbShopifyId && shopifyMediaId === thumbShopifyId) {
              return true;
            }
            const target = thumb.getAttribute('data-target') || thumb.getAttribute('data-media-id');
            const buttonTarget = thumb.querySelector('button')?.getAttribute('data-target');
            const cleanMediaId = mediaId ? mediaId.replace('Slide-', '').replace('MediaGallery-', '') : '';
            return (target && cleanMediaId && target.includes(cleanMediaId)) ||
                   (buttonTarget && cleanMediaId && buttonTarget.includes(cleanMediaId));
          }) || thumbnailItems[index];
        }

        return {
          element,
          thumbnailElement,
          originalIndex: index,
          shopifyMediaId,
          mediaId,
          altText
        };
      });
    }

    getProductMediaMap() {
      const jsonScript = this.container.querySelector('script[data-product-media-map]');
      if (jsonScript) {
        try {
          const mediaList = JSON.parse(jsonScript.textContent);
          const map = {};
          mediaList.forEach(m => {
            map[String(m.id)] = {
              id: m.id,
              alt: m.alt,
              variantIds: m.variant_ids || [],
              variantColors: (m.variant_colors || []).map(c => normalizeString(c)).filter(Boolean)
            };
          });
          return map;
        } catch (e) {}
      }
      return {};
    }

    getAllProductColors() {
      const colors = [];
      const pickers = document.querySelectorAll('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, form[action*="/cart/add"], .product-form');
      for (const picker of pickers) {
        const inputs = picker.querySelectorAll('input[type="radio"], select option, button[data-value]');
        inputs.forEach(input => {
          const val = input.value || input.getAttribute('data-value') || input.textContent.trim();
          const parent = input.closest('fieldset, .product-form__input, .selector-wrapper, div');
          const name = parent?.getAttribute('name') || parent?.getAttribute('data-option-name') || parent?.querySelector('legend, label')?.textContent || '';
          if (COLOR_OPTION_REGEX.test(name.split(':')[0].trim()) && val && !colors.includes(val)) {
            colors.push(val);
          }
        });
      }
      return colors;
    }

    detectSelectedColor() {
      const pickers = document.querySelectorAll('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, form[action*="/cart/add"], .product-form, .product-single__options');
      
      for (const picker of pickers) {
        const fieldsets = picker.querySelectorAll('fieldset, .product-form__input, .selector-wrapper');
        for (const fieldset of fieldsets) {
          const nameOrLegend = fieldset.getAttribute('name') || fieldset.getAttribute('data-option-name') || fieldset.querySelector('legend, label')?.textContent || '';
          const cleanedName = nameOrLegend.split(':')[0].trim();
          if (COLOR_OPTION_REGEX.test(cleanedName)) {
            const checkedRadio = fieldset.querySelector('input[type="radio"]:checked');
            if (checkedRadio) {
              return checkedRadio.value || checkedRadio.getAttribute('data-value');
            }
            const activeSwatch = fieldset.querySelector('button.is-active, button[aria-checked="true"], .active');
            if (activeSwatch) {
              return activeSwatch.getAttribute('data-value') || activeSwatch.getAttribute('value') || activeSwatch.textContent.trim();
            }
          }
        }

        const selects = picker.querySelectorAll('select');
        for (const select of selects) {
          const labelText = select.getAttribute('name') || select.getAttribute('aria-label') || select.getAttribute('data-option-name') || select.previousElementSibling?.textContent || select.closest('div')?.querySelector('label')?.textContent || '';
          const cleanedLabel = labelText.split(':')[0].trim();
          if (COLOR_OPTION_REGEX.test(cleanedLabel)) {
            return select.value;
          }
        }
      }

      if (window.ShopifyAnalytics?.meta?.selectedVariant?.options) {
        const options = window.ShopifyAnalytics.meta.product?.options || [];
        const colorIndex = options.findIndex(opt => COLOR_OPTION_REGEX.test(opt));
        if (colorIndex !== -1 && window.ShopifyAnalytics.meta.selectedVariant.options[colorIndex]) {
          return window.ShopifyAnalytics.meta.selectedVariant.options[colorIndex];
        }
      }

      return null;
    }

    update(forceColor = null, variantObj = null) {
      this.initCache();

      const selectedColor = forceColor || this.detectSelectedColor();
      const featuredMediaId = variantObj?.featured_media?.id || variantObj?.featured_image?.id;

      const normSelected = normalizeString(selectedColor);
      this.currentColor = normSelected;
      this.currentFeaturedMediaId = featuredMediaId;

      const mediaMap = this.getProductMediaMap();
      const availableColors = this.getAllProductColors();

      const commonList = [];
      const matchList = [];
      const otherList = [];

      this.mediaCache.forEach(item => {
        const isFeaturedMedia = featuredMediaId && item.mediaId && item.mediaId.includes(String(featuredMediaId));
        
        const shopifyId = item.shopifyMediaId || (item.mediaId ? item.mediaId.split('-').pop() : null);
        const mediaMeta = mediaMap[shopifyId] || {};

        const variantColors = mediaMeta.variantColors || [];
        const hasVariantColors = variantColors.length > 0;
        const belongsToSelectedColor = hasVariantColors && variantColors.includes(normSelected);
        const belongsToOtherColor = hasVariantColors && !belongsToSelectedColor;

        const altText = item.altText || mediaMeta.alt || '';
        const parsed = parseAltTag(altText, availableColors);

        if (isFeaturedMedia || belongsToSelectedColor) {
          matchList.push({ ...item, number: -1 }); // Priority #-1
        } else if (belongsToOtherColor) {
          otherList.push(item); // Hide image & thumbnail if associated with another variant color in Admin
        } else if (!parsed.isShared && parsed.color === normSelected) {
          matchList.push({ ...item, number: parsed.number }); // Alt text tagged (e.g. Green-1)
        } else if (parsed.isShared) {
          commonList.push(item); // Shared untagged image
        } else {
          otherList.push(item);
        }
      });

      // Log warning if color selected but no matching image found
      if (selectedColor && matchList.length === 0 && !featuredMediaId) {
        console.warn(
          `[Variant Gallery Sync Warning] No image match found for Color "${selectedColor}". ` +
          `Please assign a Media image directly to this variant in Shopify Admin or tag with "${selectedColor}-1".`
        );
      }

      // Sort variant's own images by numeric index (Green-1 before Green-2)
      matchList.sort((a, b) => (a.number || 0) - (b.number || 0) || a.originalIndex - b.originalIndex);
      // Sort shared images by original media list order
      commonList.sort((a, b) => a.originalIndex - b.originalIndex);

      // Combined order: [Selected Variant Tagged Images in Number Order] + [Shared Images in Product Order]
      let visibleItems = [];
      if (matchList.length > 0 && commonList.length > 0) {
        visibleItems = [...matchList, ...commonList];
      } else if (matchList.length > 0) {
        visibleItems = [...matchList];
      } else if (commonList.length > 0) {
        visibleItems = [...commonList];
      } else {
        visibleItems = [...this.mediaCache];
      }

      const visibleSet = new Set(visibleItems.map(i => i.element));

      // Synchronize visibility of BOTH Main Media slides and Thumbnail items
      this.mediaCache.forEach(item => {
        const isVisible = visibleSet.has(item.element);

        [item.element, item.thumbnailElement].forEach(el => {
          if (!el) return;

          el.classList.add('g-color-filter-transition');

          if (isVisible) {
            el.classList.remove('g-color-filter-hidden', 'hidden');
            el.classList.add('g-color-filter-visible');
            el.style.display = '';
            el.style.opacity = '1';
          } else {
            el.classList.remove('g-color-filter-visible');
            el.classList.add('g-color-filter-hidden');
            el.style.display = 'none';
            el.style.opacity = '0';
          }
        });
      });

      // Re-append nodes in exact order: Variant Tagged FIRST (in numeric order), then Shared
      visibleItems.forEach(item => {
        if (item.element && this.mainList) {
          this.mainList.appendChild(item.element);
        }
        if (item.thumbnailElement && this.thumbnailContainer) {
          const list = this.thumbnailContainer.querySelector('ul') || this.thumbnailContainer;
          list.appendChild(item.thumbnailElement);
        }
      });

      // Update active slide and slider pagination/counters
      if (visibleItems.length > 0) {
        const firstItem = visibleItems[0];
        
        if (typeof this.container.setActiveMedia === 'function') {
          const mediaId = firstItem.element.getAttribute('data-media-id');
          if (mediaId) {
            this.container.setActiveMedia(mediaId, false);
          }
        } else {
          this.mediaCache.forEach(i => {
            if (i.element) i.element.classList.remove('is-active', 'active');
            if (i.thumbnailElement) i.thumbnailElement.classList.remove('is-active', 'active');
          });
          if (firstItem.element) firstItem.element.classList.add('is-active');
          if (firstItem.thumbnailElement) firstItem.thumbnailElement.classList.add('is-active');
        }

        const counterTotal = this.container.querySelector('.slider-counter--total');
        if (counterTotal) {
          counterTotal.textContent = visibleItems.length;
        }

        if (this.container.elements?.viewer?.resetPages) {
          this.container.elements.viewer.resetPages();
        }
        if (this.container.elements?.thumbnails?.resetPages) {
          this.container.elements.thumbnails.resetPages();
        }
      }
    }
  }

  const instances = new WeakMap();

  function initGalleries() {
    const containers = document.querySelectorAll('media-gallery, [id^="MediaGallery-"], .product__gallery, .product-single__photos');
    containers.forEach(container => {
      if (!instances.has(container)) {
        instances.set(container, new GalleryColorFilterInstance(container));
      } else {
        instances.get(container).update();
      }
    });
  }

  function updateAllGalleries(color = null, variantObj = null) {
    const containers = document.querySelectorAll('media-gallery, [id^="MediaGallery-"], .product__gallery, .product-single__photos');
    containers.forEach(container => {
      let instance = instances.get(container);
      if (!instance) {
        instance = new GalleryColorFilterInstance(container);
        instances.set(container, instance);
      }
      instance.update(color, variantObj);
    });
  }

  function attachEventListeners() {
    document.addEventListener('variant:change', (e) => {
      const variant = e.detail?.variant;
      if (variant) {
        const product = e.detail?.product || window.ShopifyAnalytics?.meta?.product;
        if (product?.options) {
          const colorIdx = product.options.findIndex(opt => COLOR_OPTION_REGEX.test(opt));
          const colorVal = colorIdx !== -1 ? variant.options?.[colorIdx] : null;
          updateAllGalleries(colorVal, variant);
          return;
        }
      }
      updateAllGalleries();
    });

    document.addEventListener('variant-change', (e) => {
      const variant = e.detail?.variant;
      updateAllGalleries(null, variant);
    });
    document.addEventListener('option:change', () => updateAllGalleries());

    document.addEventListener('change', (e) => {
      const target = e.target;
      if (target.matches('input[type="radio"], select, input[type="checkbox"]')) {
        const picker = target.closest('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, .product-form');
        if (picker) {
          setTimeout(() => updateAllGalleries(), 0);
        }
      }
    });

    document.addEventListener('click', (e) => {
      const button = e.target.closest('button, label, .swatch');
      if (button) {
        const picker = button.closest('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, .product-form');
        if (picker) {
          setTimeout(() => updateAllGalleries(), 10);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initGalleries();
      attachEventListeners();
    });
  } else {
    initGalleries();
    attachEventListeners();
  }

  window.ProductGalleryColorFilter = {
    init: initGalleries,
    update: updateAllGalleries
  };
})();
