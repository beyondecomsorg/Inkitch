/**
 * Product Gallery Color Filter & Variant Sync
 * Synchronizes product gallery images with selected Color variant using Alt Text matching:
 * 1. Reads selected variant color name (e.g. Green, Gray, Black)
 * 2. Compares selected color case-insensitively with each product media's Alt Text
 * 3. Displays matching images (e.g. Alt Text: "Green", "Green-1", "Green 2")
 * 4. Hides all media matching other variant colors (e.g. Gray, Black when Green is selected)
 * 5. Re-indexes gallery, updates thumbnails, slider counter, and resets active media
 * 6. Gracefully falls back to all images if no color match is found
 */

(function () {
  'use strict';

  // Inject CSS styles for hiding/showing filtered media
  const styleId = 'gallery-color-filter-styles';
  if (!document.getElementById(styleId)) {
    const styleTag = document.createElement('style');
    styleTag.id = styleId;
    styleTag.innerHTML = `
      .g-color-filter-hidden {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        position: absolute !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
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

  const COLOR_NAME_REGEX = /^(colou?r|farbe|couleur|coloris|colore|cor|shade|finish|style|shape|design|pattern|model|material|pack|size)$/i;
  const TYPE_NAME_REGEX = /^(type|typ|art)$/i;

  function normalizeForMatching(str) {
    if (!str) return '';
    return String(str)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, '-');
  }

  function normalizeString(str) {
    if (!str) return '';
    return String(str).trim().toLowerCase();
  }

  function getMediaAltText(element) {
    if (!element) return '';

    // 1. Check attributes on slide element
    let alt = element.getAttribute('data-variant-tag') ||
              element.getAttribute('data-alt') ||
              element.getAttribute('data-media-alt');
    if (alt !== null && alt !== undefined && alt.trim() !== '') {
      return alt.trim();
    }

    // 2. Check inner button data-variant-tag
    const button = element.querySelector('button[data-variant-tag]');
    if (button) {
      alt = button.getAttribute('data-variant-tag');
      if (alt !== null && alt !== undefined && alt.trim() !== '') return alt.trim();
    }

    // 3. Check inner img alt attribute
    const img = element.querySelector('img');
    if (img) {
      alt = img.getAttribute('alt');
      if (alt !== null && alt !== undefined && alt.trim() !== '') return alt.trim();
    }

    return '';
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
      const mainList = this.container.querySelector('.product__media-list, .product-single__photos, .product__gallery, .product-slideshow, ul.slider') ||
                       this.container;
      
      const mainItems = Array.from(mainList.querySelectorAll('.product__media-item, .product-single__media-wrapper, .product-gallery__media, [data-media-id], .slider__slide, .swiper-slide, .slick-slide'))
        .filter((item, index, self) => self.indexOf(item) === index);

      const thumbnailContainer = this.container.querySelector('.thumbnail-list, .product__thumb-item, .product-gallery__thumbnails, [id^="GalleryThumbnails"]') ||
                                 document.querySelector('.thumbnail-list, [id^="GalleryThumbnails"]');
      let thumbnailItems = [];
      if (thumbnailContainer) {
        thumbnailItems = Array.from(thumbnailContainer.querySelectorAll('.thumbnail-list__item, .product__thumb-item, [data-target], .thumbnail-item'));
      }

      this.mainList = mainList;
      this.thumbnailContainer = thumbnailContainer;

      this.mediaCache = mainItems.map((element, index) => {
        const altText = getMediaAltText(element);
        const shopifyMediaId = element.getAttribute('data-shopify-media-id');
        const mediaId = element.getAttribute('data-media-id') || element.getAttribute('id');
        const cleanMediaId = mediaId ? mediaId.replace('Slide-', '').replace('MediaGallery-', '') : '';

        let thumbnailElement = null;
        if (thumbnailItems.length > 0) {
          thumbnailElement = thumbnailItems.find(thumb => {
            const thumbShopifyId = thumb.getAttribute('data-shopify-media-id');
            if (shopifyMediaId && thumbShopifyId && shopifyMediaId === thumbShopifyId) {
              return true;
            }
            const target = thumb.getAttribute('data-target') || thumb.getAttribute('data-media-id') || '';
            const buttonTarget = thumb.querySelector('button')?.getAttribute('data-target') || '';
            return (cleanMediaId && (target.includes(cleanMediaId) || buttonTarget.includes(cleanMediaId)));
          });
          if (!thumbnailElement && index < thumbnailItems.length) {
            thumbnailElement = thumbnailItems[index];
          }
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
      const colors = new Set();
      const pickers = document.querySelectorAll('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, form[action*="/cart/add"], .product-form, .product-single__options');
      
      for (const picker of pickers) {
        const fieldsets = picker.querySelectorAll('fieldset, .product-form__input, .selector-wrapper');
        for (const fieldset of fieldsets) {
          const nameAttr = fieldset.getAttribute('name') || fieldset.getAttribute('data-option-name') || '';
          const legendText = fieldset.querySelector('legend, label')?.textContent || '';
          const optionName = (nameAttr || legendText).split(':')[0].trim();

          if (COLOR_NAME_REGEX.test(optionName) || /color/i.test(optionName)) {
            const inputs = fieldset.querySelectorAll('input[type="radio"], button[data-value], .swatch');
            inputs.forEach(input => {
              const val = input.value || input.getAttribute('data-value') || input.getAttribute('value') || input.textContent.trim();
              if (val && val.length < 30) colors.add(val.trim());
            });
          }
        }

        const selects = picker.querySelectorAll('select');
        for (const select of selects) {
          const labelText = select.getAttribute('name') || select.getAttribute('aria-label') || select.getAttribute('data-option-name') || select.previousElementSibling?.textContent || select.closest('div')?.querySelector('label')?.textContent || '';
          const optionName = labelText.split(':')[0].trim();
          if (COLOR_NAME_REGEX.test(optionName) || /color/i.test(optionName)) {
            Array.from(select.options).forEach(opt => {
              if (opt.value) colors.add(opt.value.trim());
            });
          }
        }
      }

      return Array.from(colors);
    }

    getOptionIndexByName(regex, extraTest = null) {
      const matchName = (name) => regex.test(name) || (extraTest && extraTest.test(name));
      if (window.ShopifyAnalytics?.meta?.product?.options) {
        const idx = window.ShopifyAnalytics.meta.product.options.findIndex(opt => matchName(opt));
        if (idx !== -1) return idx;
      }
      const pickers = document.querySelectorAll('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, form[action*="/cart/add"], .product-form, .product-single__options');
      for (const picker of pickers) {
        const fieldsets = picker.querySelectorAll('fieldset, .product-form__input, .selector-wrapper, select');
        const seenOptions = [];
        for (const el of fieldsets) {
          const nameAttr = el.getAttribute('name') || el.getAttribute('data-option-name') || '';
          const legendText = el.querySelector('legend, label')?.textContent || '';
          const labelText = el.previousElementSibling?.textContent || el.closest('div')?.querySelector('label')?.textContent || '';
          const optionName = (nameAttr || legendText || labelText).split(':')[0].trim();
          if (optionName && !seenOptions.includes(optionName)) {
            seenOptions.push(optionName);
          }
        }
        const idx = seenOptions.findIndex(opt => matchName(opt));
        if (idx !== -1) return idx;
      }
      return -1;
    }

    detectSelectedOptionByName(regex, extraTest = null) {
      const matchName = (name) => regex.test(name) || (extraTest && extraTest.test(name));
      const pickers = document.querySelectorAll('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, form[action*="/cart/add"], .product-form, .product-single__options');
      
      for (const picker of pickers) {
        const fieldsets = picker.querySelectorAll('fieldset, .product-form__input, .selector-wrapper');
        for (const fieldset of fieldsets) {
          const nameAttr = fieldset.getAttribute('name') || fieldset.getAttribute('data-option-name') || '';
          const legendText = fieldset.querySelector('legend, label')?.textContent || '';
          const optionName = (nameAttr || legendText).split(':')[0].trim();

          if (matchName(optionName)) {
            const checkedRadio = fieldset.querySelector('input[type="radio"]:checked');
            if (checkedRadio) {
              const val = checkedRadio.value || checkedRadio.getAttribute('data-value');
              if (val) return val.trim();
            }
            const activeSwatch = fieldset.querySelector('button.is-active, button[aria-checked="true"], button.active, .swatch-input__input:checked');
            if (activeSwatch) {
              const val = activeSwatch.getAttribute('data-value') || activeSwatch.getAttribute('value') || activeSwatch.value || activeSwatch.textContent.trim();
              if (val) return val.trim();
            }
            const selectedSpan = fieldset.querySelector('[data-selected-value]');
            if (selectedSpan && selectedSpan.textContent.trim()) {
              return selectedSpan.textContent.trim();
            }
          }
        }

        const selects = picker.querySelectorAll('select');
        for (const select of selects) {
          const labelText = select.getAttribute('name') || select.getAttribute('aria-label') || select.getAttribute('data-option-name') || select.previousElementSibling?.textContent || select.closest('div')?.querySelector('label')?.textContent || '';
          const optionName = labelText.split(':')[0].trim();
          if (matchName(optionName)) {
            if (select.value) return select.value.trim();
          }
        }
      }

      if (window.ShopifyAnalytics?.meta?.selectedVariant?.options) {
        const options = window.ShopifyAnalytics.meta.product?.options || [];
        const optionIndex = options.findIndex(opt => matchName(opt));
        if (optionIndex !== -1 && window.ShopifyAnalytics.meta.selectedVariant.options[optionIndex]) {
          return window.ShopifyAnalytics.meta.selectedVariant.options[optionIndex];
        }
      }

      return null;
    }

    detectSelectedColor(variantObj = null) {
      if (variantObj && variantObj.options) {
        const colorIndex = this.getOptionIndexByName(COLOR_NAME_REGEX, /color/i);
        if (colorIndex !== -1 && variantObj.options[colorIndex]) {
          return variantObj.options[colorIndex].trim();
        }
      }
      const valFromDom = this.detectSelectedOptionByName(COLOR_NAME_REGEX, /color/i);
      if (valFromDom) return valFromDom;

      if (window.ShopifyAnalytics?.meta?.selectedVariant?.options) {
        const options = window.ShopifyAnalytics.meta.product?.options || [];
        const colorIndex = options.findIndex(opt => COLOR_NAME_REGEX.test(opt) || /color/i.test(opt));
        if (colorIndex !== -1 && window.ShopifyAnalytics.meta.selectedVariant.options[colorIndex]) {
          return window.ShopifyAnalytics.meta.selectedVariant.options[colorIndex];
        }
      }

      return null;
    }

    detectSelectedType(variantObj = null) {
      if (variantObj && variantObj.options) {
        const typeIndex = this.getOptionIndexByName(TYPE_NAME_REGEX);
        if (typeIndex !== -1 && variantObj.options[typeIndex]) {
          return variantObj.options[typeIndex].trim();
        }
      }
      const valFromDom = this.detectSelectedOptionByName(TYPE_NAME_REGEX);
      if (valFromDom) return valFromDom;

      if (window.ShopifyAnalytics?.meta?.selectedVariant?.options) {
        const options = window.ShopifyAnalytics.meta.product?.options || [];
        const typeIndex = options.findIndex(opt => TYPE_NAME_REGEX.test(opt));
        if (typeIndex !== -1 && window.ShopifyAnalytics.meta.selectedVariant.options[typeIndex]) {
          return window.ShopifyAnalytics.meta.selectedVariant.options[typeIndex];
        }
      }

      return null;
    }

    getAllProductTypes() {
      const types = new Set();
      const pickers = document.querySelectorAll('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, form[action*="/cart/add"], .product-form, .product-single__options');
      
      for (const picker of pickers) {
        const fieldsets = picker.querySelectorAll('fieldset, .product-form__input, .selector-wrapper');
        for (const fieldset of fieldsets) {
          const nameAttr = fieldset.getAttribute('name') || fieldset.getAttribute('data-option-name') || '';
          const legendText = fieldset.querySelector('legend, label')?.textContent || '';
          const optionName = (nameAttr || legendText).split(':')[0].trim();

          if (TYPE_NAME_REGEX.test(optionName)) {
            const inputs = fieldset.querySelectorAll('input[type="radio"], button[data-value], .swatch');
            inputs.forEach(input => {
              const val = input.value || input.getAttribute('data-value') || input.getAttribute('value') || input.textContent.trim();
              if (val && val.length < 30) types.add(val.trim());
            });
          }
        }

        const selects = picker.querySelectorAll('select');
        for (const select of selects) {
          const labelText = select.getAttribute('name') || select.getAttribute('aria-label') || select.getAttribute('data-option-name') || select.previousElementSibling?.textContent || select.closest('div')?.querySelector('label')?.textContent || '';
          const optionName = labelText.split(':')[0].trim();
          if (TYPE_NAME_REGEX.test(optionName)) {
            Array.from(select.options).forEach(opt => {
              if (opt.value) types.add(opt.value.trim());
            });
          }
        }
      }

      return Array.from(types);
    }

    update(forceColor = null, variantObj = null) {
      this.initCache();

      const selectedColor = forceColor || this.detectSelectedColor(variantObj);
      const selectedType = this.detectSelectedType(variantObj);
      const featuredMediaId = variantObj?.featured_media?.id || variantObj?.featured_image?.id;

      const normSelected = normalizeString(selectedColor);
      this.currentColor = normSelected;
      this.currentFeaturedMediaId = featuredMediaId;

      const mediaMap = this.getProductMediaMap();
      const availableColors = this.getAllProductColors();
      const availableTypes = this.getAllProductTypes();

      // STRICT expected alt text logic
      let expectedAlt = '';
      if (selectedColor && selectedType) {
        expectedAlt = `${selectedColor} - ${selectedType}`.trim().toLowerCase().replace(/\s+/g, ' ');
      } else if (selectedColor) {
        expectedAlt = selectedColor.trim().toLowerCase().replace(/\s+/g, ' ');
      }

      // Debug Logs as requested
      console.log("Selected Color:", selectedColor);
      console.log("Selected Type:", selectedType);
      console.log("Expected:", expectedAlt);

      this.mediaCache.forEach(img => {
        console.log("Image Alt:", img.altText);
      });

      const matchList = [];
      const commonList = [];
      const otherList = [];

      this.mediaCache.forEach(item => {
        const isFeaturedMedia = featuredMediaId && item.mediaId && item.mediaId.includes(String(featuredMediaId));
        const shopifyId = item.shopifyMediaId || (item.mediaId ? item.mediaId.split('-').pop() : null);
        const mediaMeta = mediaMap[shopifyId] || {};

        const altText = item.altText || mediaMeta.alt || '';
        const imageAlt = altText.trim().toLowerCase().replace(/\s+/g, ' ');

        let isMatch = false;
        let isOther = false;

        if (expectedAlt) {
          if (imageAlt === expectedAlt) {
            isMatch = true;
          } else if (imageAlt.startsWith(expectedAlt)) {
            // Guard with a boundary check to prevent partial matching (e.g. blueberry matching blue)
            const nextChar = imageAlt.charAt(expectedAlt.length);
            if (!nextChar || nextChar === ' ' || nextChar === '-' || nextChar === '_' || (nextChar >= '0' && nextChar <= '9')) {
              isMatch = true;
            }
          }

          // Check if this alt text matches any OTHER option combination
          if (!isMatch) {
            if (selectedColor && selectedType) {
              for (const color of availableColors) {
                for (const type of availableTypes) {
                  if (color.trim().toLowerCase() !== selectedColor.trim().toLowerCase() || type.trim().toLowerCase() !== selectedType.trim().toLowerCase()) {
                    const otherExpected = `${color} - ${type}`.trim().toLowerCase().replace(/\s+/g, ' ');
                    if (imageAlt === otherExpected || imageAlt.startsWith(otherExpected)) {
                      isOther = true;
                      break;
                    }
                  }
                }
                if (isOther) break;
              }
            } else if (selectedColor) {
              for (const color of availableColors) {
                if (color.trim().toLowerCase() !== selectedColor.trim().toLowerCase()) {
                  const otherExpected = color.trim().toLowerCase().replace(/\s+/g, ' ');
                  if (imageAlt === otherExpected || imageAlt.startsWith(otherExpected)) {
                    isOther = true;
                    break;
                  }
                }
              }
            }
          }
        } else {
          // If no options are selected, everything matches
          isMatch = true;
        }

        const numMatch = imageAlt.match(/\d+/);
        const number = numMatch ? parseInt(numMatch[0], 10) : 1;

        if (isMatch) {
          matchList.push({ ...item, number: number });
        } else if (isOther) {
          otherList.push(item);
        } else if (isFeaturedMedia && !isOther) {
          matchList.push({ ...item, number: -1 });
        } else {
          commonList.push(item);
        }
      });

      console.log("Matched Images:", matchList);

      matchList.sort((a, b) => (a.number || 0) - (b.number || 0) || a.originalIndex - b.originalIndex);

      let visibleItems = [];
      if (matchList.length > 0) {
        visibleItems = [...matchList];
      } else {
        visibleItems = [...this.mediaCache]; // Fallback to all images if no matches found
      }

      const visibleSet = new Set(visibleItems.map(i => i.element));

      // Synchronize visibility of BOTH Main Media slides and Thumbnail items
      this.mediaCache.forEach(item => {
        const isVisible = visibleSet.has(item.element);

        [item.element, item.thumbnailElement].forEach(el => {
          if (!el) return;

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

      // Re-append nodes in exact order: Selected Variant Tagged Images FIRST (in number order), then Shared
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
        const mediaId = firstItem.mediaId || firstItem.element.getAttribute('data-media-id');
        
        if (typeof this.container.setActiveMedia === 'function') {
          if (mediaId) {
            this.container.setActiveMedia(mediaId, false);
          }
        } else {
          this.mediaCache.forEach(i => {
            if (i.element) i.element.classList.remove('is-active', 'active');
            if (i.thumbnailElement) {
              i.thumbnailElement.classList.remove('is-active', 'active');
              i.thumbnailElement.querySelector('button')?.removeAttribute('aria-current');
            }
          });
          if (firstItem.element) firstItem.element.classList.add('is-active');
          if (firstItem.thumbnailElement) {
            firstItem.thumbnailElement.classList.add('is-active');
            firstItem.thumbnailElement.querySelector('button')?.setAttribute('aria-current', 'true');
          }
        }

        if (this.mainList) {
          this.mainList.scrollTo({ left: 0 });
        }
        if (this.thumbnailContainer) {
          const thumbList = this.thumbnailContainer.querySelector('ul') || this.thumbnailContainer;
          thumbList.scrollTo({ left: 0 });
        }

        const counterTotal = this.container.querySelector('.slider-counter--total');
        if (counterTotal) {
          counterTotal.textContent = visibleItems.length;
        }

        const counterCurrent = this.container.querySelector('.slider-counter--current');
        if (counterCurrent) {
          counterCurrent.textContent = '1';
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
    // PubSub events in Dawn theme
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      if (PUB_SUB_EVENTS.optionValueSelectionChange) {
        subscribe(PUB_SUB_EVENTS.optionValueSelectionChange, () => {
          setTimeout(() => updateAllGalleries(), 0);
        });
      }
      if (PUB_SUB_EVENTS.variantChange) {
        subscribe(PUB_SUB_EVENTS.variantChange, (e) => {
          updateAllGalleries(null, e.data?.variant);
        });
      }
    }

    document.addEventListener('variant:change', (e) => {
      const variant = e.detail?.variant;
      if (variant) {
        const product = e.detail?.product || window.ShopifyAnalytics?.meta?.product;
        if (product?.options) {
          const colorIdx = product.options.findIndex(opt => COLOR_NAME_REGEX.test(opt) || /color/i.test(opt));
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
      const button = e.target.closest('button, label, .swatch, input');
      if (button) {
        const picker = button.closest('variant-radios, variant-selects, card-variant-picker, [data-variant-picker], .variant-picker, .product-form');
        if (picker) {
          setTimeout(() => updateAllGalleries(), 10);
          setTimeout(() => updateAllGalleries(), 100);
        }
      }
    });

    const selectedValueSpans = document.querySelectorAll('[data-selected-value], legend');
    selectedValueSpans.forEach(span => {
      const observer = new MutationObserver(() => {
        updateAllGalleries();
      });
      observer.observe(span, { childList: true, characterData: true, subtree: true });
    });
  }

  function runInitialFilter() {
    initGalleries();
    attachEventListeners();
    setTimeout(() => updateAllGalleries(), 20);
    setTimeout(() => updateAllGalleries(), 150);
    setTimeout(() => updateAllGalleries(), 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInitialFilter);
  } else {
    runInitialFilter();
  }
  window.addEventListener('load', () => updateAllGalleries());

  window.ProductGalleryColorFilter = {
    init: initGalleries,
    update: updateAllGalleries
  };
})();
