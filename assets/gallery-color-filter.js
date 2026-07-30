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

  const STRICT_COLOR_REGEX = /^(colou?r|farbe|couleur|coloris|colore|cor|shade|finish|style)$/i;
  const GENERIC_OPTION_REGEX = /^(shape|design|pattern|model|material|pack|size)$/i;
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
      
      let mainItems = Array.from(mainList.querySelectorAll('.product__media-item, .product-single__media-wrapper, .product-gallery__media, [data-media-id], .slider__slide, .swiper-slide, .slick-slide'))
        .filter((item, index, self) => self.indexOf(item) === index);
      mainItems = mainItems.filter(item => {
        return !mainItems.some(other => other !== item && other.contains(item));
      });

      const thumbnailContainer = this.container.querySelector('.thumbnail-list, .product__thumb-item, .product-gallery__thumbnails, [id^="GalleryThumbnails"]') ||
                                 document.querySelector('.thumbnail-list, [id^="GalleryThumbnails"]');
      let thumbnailItems = [];
      if (thumbnailContainer) {
        thumbnailItems = Array.from(thumbnailContainer.querySelectorAll('.thumbnail-list__item, .product__thumb-item, [data-target], .thumbnail-item'))
          .filter((item, index, self) => self.indexOf(item) === index);
        thumbnailItems = thumbnailItems.filter(item => {
          return !thumbnailItems.some(other => other !== item && other.contains(item));
        });
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

          if (STRICT_COLOR_REGEX.test(optionName) || /color/i.test(optionName) || GENERIC_OPTION_REGEX.test(optionName)) {
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
          if (STRICT_COLOR_REGEX.test(optionName) || /color/i.test(optionName) || GENERIC_OPTION_REGEX.test(optionName)) {
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
        const colorIndex = this.getOptionIndexByName(STRICT_COLOR_REGEX, /color/i);
        if (colorIndex !== -1 && variantObj.options[colorIndex]) {
          return variantObj.options[colorIndex].trim();
        }
        // Fallback to generic option if no strict color is found
        const genericIndex = this.getOptionIndexByName(GENERIC_OPTION_REGEX);
        if (genericIndex !== -1 && variantObj.options[genericIndex]) {
          return variantObj.options[genericIndex].trim();
        }
      }
      const valFromDom = this.detectSelectedOptionByName(STRICT_COLOR_REGEX, /color/i) || this.detectSelectedOptionByName(GENERIC_OPTION_REGEX);
      if (valFromDom) return valFromDom;

      if (window.ShopifyAnalytics?.meta?.selectedVariant?.options) {
        const options = window.ShopifyAnalytics.meta.product?.options || [];
        let colorIndex = options.findIndex(opt => STRICT_COLOR_REGEX.test(opt) || /color/i.test(opt));
        if (colorIndex === -1) {
          colorIndex = options.findIndex(opt => GENERIC_OPTION_REGEX.test(opt));
        }
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

      // ── Normalisation helper ───────────────────────────────────────────────────
      const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

      const normColor = norm(selectedColor);
      const normType  = norm(selectedType);

      // ── Build every prefix that belongs to the SELECTED variant ───────────────
      // Supported Alt Text formats (new format):
      //   "{Color}"                       → color-only image  (exact match)
      //   "{Color}-{Type}-{N}"            → specific combo    (prefix: "color-type-")
      //
      // We build a list of prefix strings the selected variant's images start with.
      // E.g. selected Blue + Tiffin + Tumbler:
      //   selectedColorTypePrefixes = [ "blue-tiffin + tumbler-" ]
      //
      // A color-only image ("blue") is matched separately by exact equality with normColor.

      const buildComboPrefixes = (color, type) => {
        if (!color) return [];
        const c = norm(color);
        if (!type) return [];
        const t = norm(type);
        // Support hyphens ("Color-Type-N", "Color- Type-N") and pluses ("Color+Type-N", "Color+ Type-N")
        return [
          `${c}-${t}-`,       // "blue-without bottle-1"
          `${c}- ${t}-`,      // "blue- without bottle-1"
          `${c} - ${t}-`,     // "blue - without bottle-1"
          `${c}+${t}-`,       // "blue+without bottle-1"
          `${c}+ ${t}-`,      // "blue+ without bottle-1"
          `${c} + ${t}-`,     // "blue + without bottle-1"
        ];
      };

      // Prefixes the selected color+type images start with
      const selectedPrefixes = buildComboPrefixes(selectedColor, selectedType);

      // ── Build prefixes that belong to OTHER variants (for exclusion) ──────────
      // An image is "other" if its alt starts with any of these.
      const otherPrefixes = [];
      availableColors.forEach(color => {
        availableTypes.forEach(type => {
          // Skip the currently selected combination
          if (norm(color) === normColor && norm(type) === normType) return;
          buildComboPrefixes(color, type).forEach(p => otherPrefixes.push(p));
        });
        // Add same-color/different-type prefixes when a type IS selected
        // (handled above since we iterate all types)
      });

      // Other bare-color strings (e.g. "blue" when selected color is "pink")
      const otherColorExact = availableColors
        .map(c => norm(c))
        .filter(c => c !== normColor);

      // Debug logs
      console.log('[GCF] Selected Color   :', selectedColor);
      console.log('[GCF] Selected Type    :', selectedType);
      console.log('[GCF] Selected prefixes:', selectedPrefixes);
      console.log('[GCF] Other prefixes   :', otherPrefixes);
      console.log('[GCF] Other color exact:', otherColorExact);
      this.mediaCache.forEach(img =>
        console.log('[GCF] Image alt raw    :', JSON.stringify(img.altText))
      );

      // ── Image classification ───────────────────────────────────────────────────
      const matchingImages   = [];
      const defaultImages    = [];
      const otherColorImages = [];

      this.mediaCache.forEach(item => {
        const shopifyId = item.shopifyMediaId || (item.mediaId ? item.mediaId.split('-').pop() : null);
        const mediaMeta = mediaMap[shopifyId] || {};
        const rawAlt    = item.altText || mediaMeta.alt || '';
        const imageAlt  = norm(rawAlt);

        // Videos / models are never filtered
        const isNonImageMedia = !!item.element.querySelector('deferred-media, .deferred-media, product-model') ||
                                 item.element.classList.contains('product__media-item--full');
        if (isNonImageMedia) { defaultImages.push(item); return; }

        // No color selected → show everything
        if (!selectedColor) { matchingImages.push(item); return; }

        // ── MATCH: color-only image (exact: "blue") ────────────────────────────
        if (imageAlt === normColor) {
          console.log('[GCF] ✅ MATCH (color-only):', imageAlt);
          matchingImages.push(item);
          return;
        }

        // ── MATCH: specific combo with number suffix  ("blue-tiffin + tumbler-2") ──
        if (selectedPrefixes.length > 0 && selectedPrefixes.some(p => imageAlt.startsWith(p))) {
          console.log('[GCF] ✅ MATCH (combo prefix):', imageAlt);
          matchingImages.push(item);
          return;
        }

        // ── EXCLUDE: starts with a DIFFERENT color (e.g. "black+ bottle-1" when selected is "blue") ──
        const startsWithOtherColor = otherColorExact.some(c => {
          const starts = imageAlt.startsWith(c);
          if (!starts) return false;
          const nextChar = imageAlt.charAt(c.length);
          return !nextChar || nextChar === ' ' || nextChar === '-' || nextChar === '+' || nextChar === '_';
        });
        if (startsWithOtherColor) {
          console.log('[GCF] ❌ EXCLUDED (starts with other color):', imageAlt);
          otherColorImages.push(item);
          return;
        }

        // ── EXCLUDE: belongs to a DIFFERENT combo of the SAME color ──
        if (otherPrefixes.some(p => imageAlt.startsWith(p))) {
          console.log('[GCF] ❌ EXCLUDED (other combo):', imageAlt);
          otherColorImages.push(item);
          return;
        }

        // ── DEFAULT: untagged / neutral – always visible ───────────────────────
        console.log('[GCF] ℹ️  DEFAULT (untagged):', imageAlt);
        defaultImages.push(item);
      });

      // Sort matching images based on the suffix number in the Alt Text (e.g. "Blue-Without Bottle-3" -> 3)
      const getAltOrder = (item) => {
        const shopifyId = item.shopifyMediaId || (item.mediaId ? item.mediaId.split('-').pop() : null);
        const mediaMeta = mediaMap[shopifyId] || {};
        const rawAlt    = item.altText || mediaMeta.alt || '';
        const imageAlt  = norm(rawAlt);
        
        // Match a hyphen or plus followed by a number at the end, e.g. "-3" or "+3"
        const match = imageAlt.match(/[-+]\s*(\d+)$/);
        if (match) {
          return parseInt(match[1], 10);
        }
        return 999; // Default fallback for unnumbered items
      };

      matchingImages.sort((a, b) => {
        const orderA = getAltOrder(a);
        const orderB = getAltOrder(b);
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.originalIndex - b.originalIndex;
      });

      defaultImages.sort((a, b) => a.originalIndex - b.originalIndex);

      let visibleItems = [];
      if (matchingImages.length > 0) {
        visibleItems = [...matchingImages, ...defaultImages];
      } else {
        // No exact match found → graceful fallback: show everything
        console.warn('[GCF] No matching images found – showing all as fallback');
        visibleItems = [...this.mediaCache];
      }

      // ── Pin video/model slides to position 3 (index 2) ───────────────────────────
      // Separate video/model items from image items, then splice them back in at slot 2.
      const VIDEO_POSITION = 2; // 0-based → 3rd slot
      const videoItems  = visibleItems.filter(item =>
        !!item.element.querySelector('deferred-media, .deferred-media, product-model')
      );
      const imageItems  = visibleItems.filter(item =>
        !item.element.querySelector('deferred-media, .deferred-media, product-model')
      );
      if (videoItems.length > 0) {
        // Clamp insertion point so it never exceeds the image list length
        const insertAt = Math.min(VIDEO_POSITION, imageItems.length);
        imageItems.splice(insertAt, 0, ...videoItems);
        visibleItems = imageItems;
        console.log('[GCF] 🎬 Video pinned to position', VIDEO_POSITION + 1, '– order:',
          visibleItems.map(i => i.altText || i.mediaId));
      }

      console.log('[GCF] Visible items count:', visibleItems.length);
      console.log('[GCF] Matching images:', matchingImages.map(i => i.altText));
      console.log('[GCF] Default/Untagged:', defaultImages.map(i => i.altText));
      console.log('[GCF] Excluded images :', otherColorImages.map(i => i.altText));

      // 1. Hide all thumbnails
      if (this.thumbnailContainer) {
        const allThumbs = this.thumbnailContainer.querySelectorAll('.thumbnail-list__item, .product__thumb-item, [data-target], .thumbnail-item');
        allThumbs.forEach(thumb => {
          thumb.classList.remove('g-color-filter-visible');
          thumb.classList.add('g-color-filter-hidden');
          thumb.style.display = 'none';
          thumb.style.opacity = '0';
        });
      }

      // 2. Hide all main slide elements
      if (this.mainList) {
        const allSlides = this.mainList.querySelectorAll('.product__media-item, .product-single__media-wrapper, .product-gallery__media, [data-media-id], .slider__slide, .swiper-slide, .slick-slide');
        allSlides.forEach(slide => {
          slide.classList.remove('g-color-filter-visible');
          slide.classList.add('g-color-filter-hidden');
          slide.style.display = 'none';
          slide.style.opacity = '0';
        });
      }

      const visibleSet = new Set(visibleItems.map(i => i.element));

      // 3. Synchronize visibility
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

      // 4. Re-append nodes in order: Matching → Defaults
      visibleItems.forEach(item => {
        if (item.element && this.mainList) {
          this.mainList.appendChild(item.element);
        }
        if (item.thumbnailElement && this.thumbnailContainer) {
          const list = this.thumbnailContainer.querySelector('ul') || this.thumbnailContainer;
          list.appendChild(item.thumbnailElement);
        }
      });

      // 5. Update active slide and slider counters
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

        // 6. Reset slider scroll positions to start
        if (this.mainList) {
          this.mainList.scrollTo({ left: 0 });
          this.mainList.scrollLeft = 0;
        }
        if (this.thumbnailContainer) {
          const thumbList = this.thumbnailContainer.querySelector('ul') || this.thumbnailContainer;
          thumbList.scrollTo({ left: 0 });
          thumbList.scrollLeft = 0;
        }

        const counterTotal = this.container.querySelector('.slider-counter--total');
        if (counterTotal) counterTotal.textContent = visibleItems.length;

        const counterCurrent = this.container.querySelector('.slider-counter--current');
        if (counterCurrent) counterCurrent.textContent = '1';

        // 7. Refresh Dawn slider pagination
        if (this.container.elements?.viewer?.resetPages) this.container.elements.viewer.resetPages();
        if (this.container.elements?.thumbnails?.resetPages) this.container.elements.thumbnails.resetPages();

        // 8. Refresh 3rd-party sliders if present
        if (this.container.swiper && typeof this.container.swiper.update === 'function') {
          this.container.swiper.update();
          this.container.swiper.slideTo(0, 0);
        }
        if (this.container.flickity && typeof this.container.flickity.resize === 'function') {
          this.container.flickity.resize();
          this.container.flickity.select(0, false, true);
        }
        if (this.container.splide && typeof this.container.splide.refresh === 'function') {
          this.container.splide.refresh();
          this.container.splide.go(0);
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
          let colorIdx = product.options.findIndex(opt => STRICT_COLOR_REGEX.test(opt) || /color/i.test(opt));
          if (colorIdx === -1) {
            colorIdx = product.options.findIndex(opt => GENERIC_OPTION_REGEX.test(opt));
          }
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
