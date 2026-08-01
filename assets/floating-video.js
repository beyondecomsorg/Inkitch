/**
 * inKitch Floating Video Widget & Reels Modal Controller
 * Built with unique classes/elements to prevent conflicts.
 */
class InKitchFloatingVideoWidget {
  constructor() {
    this.widget = document.getElementById('inKitchFloatingVideo');
    if (!this.widget) return;

    this.productId = this.widget.getAttribute('data-product-id');
    this.localStorageKey = `ink-floating-video-hidden-${this.productId}`;

    // Reset via URL query param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('test_video') || urlParams.has('reset_video') || urlParams.has('reset-video')) {
      localStorage.removeItem(this.localStorageKey);
    }

    // Check localStorage persistence
    if (localStorage.getItem(this.localStorageKey) === 'true') {
      return;
    }

    // Display widget
    this.widget.classList.remove('ink-hidden');

    this.closeBtn = document.getElementById('inKitchCloseWidget');
    this.trigger = document.getElementById('inKitchTriggerReels');
    this.popup = null;
    this.savedFocus = null;

    this.initEvents();
    this.playWidgetVideo();
  }

  playWidgetVideo() {
    const video = this.widget?.querySelector('.ink-widget-media');
    if (video) {
      video.muted = true;
      video.play().catch(err => console.log('Widget play attempt:', err));

      if (!video.dataset.hasPauseListener) {
        video.dataset.hasPauseListener = 'true';
        video.addEventListener('pause', () => {
          if (!this.widget.classList.contains('ink-hidden')) {
            video.play().catch(err => console.log('Widget auto-resume attempt:', err));
          }
        });
      }
    }
  }

  initEvents() {
    this.closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeWidget();
    });

    this.trigger.addEventListener('click', () => this.openPopup());
    this.trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openPopup();
      }
    });
  }

  closeWidget() {
    this.widget.classList.add('ink-hidden');
    localStorage.setItem(this.localStorageKey, 'true');
  }

  openPopup() {
    this.savedFocus = document.activeElement;

    if (!this.popup) {
      const template = document.getElementById('inKitchReelsTemplate');
      if (!template) return;

      const clone = template.content.cloneNode(true);
      document.body.appendChild(clone);
      
      const overlays = document.querySelectorAll('.ink-reels-overlay');
      this.popup = overlays[overlays.length - 1];

      this.initPopupEvents();
    }

    this.popup.style.display = 'flex';
    this.popup.setAttribute('aria-hidden', 'false');
    
    const video = this.popup.querySelector('.ink-reels-media');
    if (video) {
      video.muted = true;
      video.play().catch(err => console.log('Autoplay prevented:', err));
    }

    const popupCloseBtn = this.popup.querySelector('.ink-reels-close-btn');
    if (popupCloseBtn) {
      popupCloseBtn.focus();
    }

    this.trapFocus(this.popup);
  }

  initPopupEvents() {
    const closeBtn = this.popup.querySelector('.ink-reels-close-btn');
    const atcBtn = this.popup.querySelector('.ink-reels-atc-btn');

    closeBtn.addEventListener('click', () => this.closePopup());

    this.popup.addEventListener('click', (e) => {
      if (e.target === this.popup) {
        this.closePopup();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.popup.getAttribute('aria-hidden') === 'false') {
        this.closePopup();
      }
    });

    atcBtn.addEventListener('click', () => this.addToCart());
  }

  closePopup() {
    if (!this.popup) return;

    const video = this.popup.querySelector('.ink-reels-media');
    if (video) {
      video.pause();
    }

    this.popup.classList.add('ink-closing');

    this.popup.addEventListener('animationend', () => {
      this.popup.style.display = 'none';
      this.popup.classList.remove('ink-closing');
      this.popup.setAttribute('aria-hidden', 'true');
      
      if (this.savedFocus) {
        this.savedFocus.focus();
      }

      this.playWidgetVideo();
    }, { once: true });
  }

  trapFocus(element) {
    const focusableElements = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusableElements.length === 0) return;
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements[focusableElements.length - 1];

    element.addEventListener('keydown', (e) => {
      const isTabPressed = e.key === 'Tab' || e.keyCode === 9;
      if (!isTabPressed) return;

      if (e.shiftKey) {
        if (document.activeElement === firstFocusableElement) {
          lastFocusableElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastFocusableElement) {
          firstFocusableElement.focus();
          e.preventDefault();
        }
      }
    });
  }

  addToCart() {
    const atcBtn = this.popup.querySelector('.ink-reels-atc-btn');
    const spinner = atcBtn.querySelector('.loading__spinner');
    const textSpan = atcBtn.querySelector('.ink-atc-text');

    let variantId = this.widget.getAttribute('data-variant-id');
    if (!variantId) {
      const mainIdInput = document.querySelector('form[action*="/cart/add"] input[name="id"]') 
                       || document.querySelector('[name="id"]');
      if (mainIdInput) {
        variantId = mainIdInput.value;
      }
    }

    if (!variantId) {
      alert('Please select a variant first');
      return;
    }

    atcBtn.setAttribute('aria-disabled', 'true');
    atcBtn.disabled = true;
    spinner.classList.remove('hidden');
    if (textSpan) textSpan.classList.add('hidden');

    const formData = new FormData();
    formData.append('id', variantId);
    formData.append('quantity', 1);

    const cartDrawer = document.querySelector('cart-drawer');
    const cartNotification = document.querySelector('cart-notification');
    const cartElement = cartDrawer || cartNotification;

    if (cartElement) {
      formData.append(
        'sections',
        cartElement.getSectionsToRender().map((section) => section.id)
      );
      formData.append('sections_url', window.location.pathname);
      cartElement.setActiveElement(document.activeElement);
    }

    fetch(`${window.routes?.cart_add_url || '/cart/add.js'}`, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
    .then((response) => response.json())
    .then((response) => {
      atcBtn.removeAttribute('aria-disabled');
      atcBtn.disabled = false;
      spinner.classList.add('hidden');
      if (textSpan) textSpan.classList.remove('hidden');

      if (response.status) {
        alert(response.description || response.message || 'Error adding to cart');
        return;
      }

      this.closePopup();

      if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined' && PUB_SUB_EVENTS.cartUpdate) {
        publish(PUB_SUB_EVENTS.cartUpdate, {
          source: 'floating-video',
          productVariantId: variantId,
          cartData: response,
        });
      }

      if (cartDrawer) {
        cartDrawer.renderContents(response);
      } else if (cartNotification) {
        cartNotification.renderContents(response);
      } else {
        window.location = window.routes?.cart_url || '/cart';
      }
    })
    .catch((error) => {
      console.error('AJAX ATC Error:', error);
      atcBtn.removeAttribute('aria-disabled');
      atcBtn.disabled = false;
      spinner.classList.add('hidden');
      if (textSpan) textSpan.classList.remove('hidden');
      window.location = window.routes?.cart_url || '/cart';
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new InKitchFloatingVideoWidget());
} else {
  new InKitchFloatingVideoWidget();
}
