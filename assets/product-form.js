if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        this.variantIdInput.disabled = false;
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton.querySelector('span');

        if (document.querySelector('cart-drawer')) this.submitButton.setAttribute('aria-haspopup', 'dialog');

        this.hideErrors = this.dataset.hideErrors === 'true';
      }

      onSubmitHandler(evt) {
        evt.preventDefault();
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        this.querySelector('.loading__spinner').classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(this.form);
        if (this.cart) {
          formData.append(
            'sections',
            this.cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          this.cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then((response) => {
            if (response.status) {
              publish(PUB_SUB_EVENTS.cartError, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                errors: response.errors || response.description,
                message: response.message,
              });
              this.handleErrorMessage(response.description);

              const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
              if (!soldOutMessage) return;
              this.submitButton.setAttribute('aria-disabled', true);
              this.submitButtonText.classList.add('hidden');
              soldOutMessage.classList.remove('hidden');
              this.error = true;
              return;
            } else if (!this.cart) {
              window.location = window.routes.cart_url;
              return;
            }

            const startMarker = CartPerformance.createStartingMarker('add:wait-for-subscribers');
            if (!this.error)
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: formData.get('id'),
                cartData: response,
              }).then(() => {
                CartPerformance.measureFromMarker('add:wait-for-subscribers', startMarker);
              });
            this.error = false;
            const quickAddModal = this.closest('quick-add-modal');
            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    CartPerformance.measure("add:paint-updated-sections", () => {
                      this.cart.renderContents(response);
                    });
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else {
              CartPerformance.measure("add:paint-updated-sections", () => {
                this.cart.renderContents(response);
              });
            }
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            this.submitButton.classList.remove('loading');
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            if (!this.error) this.submitButton.removeAttribute('aria-disabled');
            this.querySelector('.loading__spinner').classList.add('hidden');

            CartPerformance.measureFromEvent("add:user-action", evt);
          });
      }

      openMobileVariantDrawer() {
        const card = this.closest('.card-wrapper');
        if (!card) return;

        const variantsScript = card.querySelector('script[data-variants]');
        const optionsScript = card.querySelector('script[data-options]');
        if (!variantsScript) return;

        const variants = JSON.parse(variantsScript.textContent);
        const options = optionsScript ? JSON.parse(optionsScript.textContent) : [];
        const productTitle = card.querySelector('.card__heading')?.textContent.trim() || '';
        const productImageSrc = card.querySelector('.card__media img')?.src || '';

        let drawer = document.getElementById('MobileVariantDrawer');
        if (!drawer) {
          drawer = document.createElement('div');
          drawer.id = 'MobileVariantDrawer';
          drawer.className = 'mobile-variant-drawer-wrapper';
          document.body.appendChild(drawer);
        }

        let optionsHTML = '';
        options.forEach((option, index) => {
          let valuesHTML = '';
          option.values.forEach(value => {
            const isSelected = variants[0].options[index] === value;
            valuesHTML += `
              <button type="button" class="drawer-pill-button${isSelected ? ' active' : ''}" data-value="${escapeHTML(value)}">
                ${escapeHTML(value)}
              </button>
            `;
          });

          optionsHTML += `
            <div class="drawer-option-row" data-option-index="${index}" data-option-name="${escapeHTML(option.name)}">
              <span class="drawer-option-label">${escapeHTML(option.name)}:</span>
              <div class="drawer-option-list">
                ${valuesHTML}
              </div>
            </div>
          `;
        });

        const initialVariant = variants[0];
        const formattedPrice = formatMoney(initialVariant.price);

        drawer.innerHTML = `
          <div class="mobile-variant-drawer-overlay"></div>
          <div class="mobile-variant-drawer-panel">
            <div class="mobile-variant-drawer-header">
              <h3>Select Options</h3>
              <button type="button" class="mobile-variant-drawer-close" aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
            <div class="mobile-variant-drawer-body">
              <div class="drawer-product-info">
                <img src="${productImageSrc}" alt="${escapeHTML(productTitle)}" class="drawer-product-image">
                <div class="drawer-product-text">
                  <div class="drawer-product-title">${escapeHTML(productTitle)}</div>
                  <div class="drawer-product-price">${formattedPrice}</div>
                </div>
              </div>
              <div class="drawer-options-wrapper">
                ${optionsHTML}
              </div>
            </div>
            <div class="mobile-variant-drawer-footer">
              <button type="button" class="drawer-add-to-bag-button button button--primary">
                <span>ADD TO BAG</span>
                <div class="loading__spinner hidden"><svg aria-hidden="true" focusable="false" class="spinner" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg"><circle class="path" fill="none" stroke-width="6" stroke-linecap="round" cx="33" cy="33" r="30"></circle></svg></div>
              </button>
            </div>
          </div>
        `;

        function formatMoney(cents) {
          const moneyFormat = window.theme?.moneyFormat || '₹{{amount}}';
          const amount = (cents / 100).toFixed(2);
          return moneyFormat.replace('{{amount}}', amount).replace('{{amount_no_decimals}}', Math.round(amount));
        }

        function escapeHTML(str) {
          return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        setTimeout(() => {
          drawer.classList.add('active');
        }, 10);

        const closeBtn = drawer.querySelector('.mobile-variant-drawer-close');
        const overlay = drawer.querySelector('.mobile-variant-drawer-overlay');
        
        const closeDrawer = () => {
          drawer.classList.remove('active');
          setTimeout(() => {
            drawer.innerHTML = '';
          }, 300);
        };

        closeBtn.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);

        const selectedOptions = {};
        options.forEach((option, index) => {
          selectedOptions[index] = variants[0].options[index];
        });

        const optionRows = drawer.querySelectorAll('.drawer-option-row');
        optionRows.forEach(row => {
          row.addEventListener('click', (e) => {
            const button = e.target.closest('.drawer-pill-button');
            if (!button) return;

            const optionIndex = row.dataset.optionIndex;
            const val = button.dataset.value;

            row.querySelectorAll('.drawer-pill-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            selectedOptions[optionIndex] = val;
            updateSelectedVariant();
          });
        });

        let currentSelectedVariant = variants[0];
        const addToBagBtn = drawer.querySelector('.drawer-add-to-bag-button');
        const priceEl = drawer.querySelector('.drawer-product-price');
        const imageEl = drawer.querySelector('.drawer-product-image');

        function updateSelectedVariant() {
          let matchedVariant = null;
          const possibleMatches = variants.filter(variant => {
            return Object.entries(selectedOptions).every(([index, val]) => {
              return variant.options[parseInt(index)] === val;
            });
          });

          if (possibleMatches.length > 0) {
            matchedVariant = possibleMatches.find(v => v.available) || possibleMatches[0];
          }

          if (matchedVariant) {
            currentSelectedVariant = matchedVariant;
            priceEl.textContent = formatMoney(matchedVariant.price);
            if (matchedVariant.featured_image) {
              imageEl.src = matchedVariant.featured_image.src;
            }

            if (matchedVariant.available) {
              addToBagBtn.removeAttribute('disabled');
              addToBagBtn.classList.remove('disabled');
              addToBagBtn.querySelector('span').textContent = 'ADD TO BAG';
            } else {
              addToBagBtn.setAttribute('disabled', 'disabled');
              addToBagBtn.classList.add('disabled');
              addToBagBtn.querySelector('span').textContent = 'SOLD OUT';
            }
          }
        }

        updateSelectedVariant();

        addToBagBtn.addEventListener('click', () => {
          if (!currentSelectedVariant || !currentSelectedVariant.available) return;

          addToBagBtn.setAttribute('aria-disabled', true);
          addToBagBtn.classList.add('loading');
          addToBagBtn.querySelector('.loading__spinner').classList.remove('hidden');

          const cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
          const sections = cart ? cart.getSectionsToRender().map((s) => s.id) : [];

          fetch(`${routes.cart_add_url}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
              id: currentSelectedVariant.id,
              quantity: 1,
              sections: sections,
              sections_url: window.location.pathname
            })
          })
          .then(res => res.json())
          .then(response => {
            if (response.status) {
              alert(response.description || response.message);
              addToBagBtn.removeAttribute('aria-disabled');
              addToBagBtn.classList.remove('loading');
              addToBagBtn.querySelector('.loading__spinner').classList.add('hidden');
              return;
            }

            const mainVariantIdInput = card.querySelector('input.product-variant-id');
            if (mainVariantIdInput) {
              mainVariantIdInput.value = currentSelectedVariant.id;
            }

            if (window.publish) {
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: currentSelectedVariant.id,
                cartData: response,
              });
            }

            const cartDrawer = document.querySelector('cart-drawer');
            if (cartDrawer) {
              cartDrawer.renderContents(response);
              cartDrawer.open();
            }

            closeDrawer();
          })
          .catch(e => {
            console.error('Error adding variant to cart from drawer:', e);
            addToBagBtn.removeAttribute('aria-disabled');
            addToBagBtn.classList.remove('loading');
            addToBagBtn.querySelector('.loading__spinner').classList.add('hidden');
          });
        });
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage) {
          this.errorMessage.textContent = errorMessage;
        }
      }

      toggleSubmitButton(disable = true, text) {
        if (disable) {
          this.submitButton.setAttribute('disabled', 'disabled');
          if (text) this.submitButtonText.textContent = text;
        } else {
          this.submitButton.removeAttribute('disabled');
          this.submitButtonText.textContent = window.variantStrings.addToCart;
        }
      }

      get variantIdInput() {
        return this.form.querySelector('[name=id]');
      }
    }
  );
}
