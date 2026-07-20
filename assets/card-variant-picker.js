if (!customElements.get('card-variant-picker')) {
  customElements.define(
    'card-variant-picker',
    class CardVariantPicker extends HTMLElement {
      constructor() {
        super();
        this.productId = this.dataset.productId;
        const variantsScript = this.querySelector('script[data-variants]');
        if (!variantsScript) return;
        this.variants = JSON.parse(variantsScript.textContent);

        this.cardContainer = this.closest('.card-wrapper') || this.closest('.card');
        this.productForm = this.cardContainer?.querySelector('product-form');
        this.variantIdInput = this.productForm?.querySelector('[name="id"]');
        this.submitButton = this.productForm?.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton?.querySelector('span');

        this.selectedOptions = {};

        // Parse pre-selected swatch buttons on load
        this.querySelectorAll('.card-variant-options__row').forEach(row => {
          const optionIndex = row.dataset.optionIndex;
          const activeBtn = row.querySelector('button.active');
          if (activeBtn) {
            this.selectedOptions[optionIndex] = activeBtn.dataset.value;
          }
        });

        this.addEventListener('click', this.onSwatchClick.bind(this));
      }

      onSwatchClick(event) {
        const button = event.target.closest('button');
        if (!button) return;

        const row = button.closest('.card-variant-options__row');
        if (!row) return;

        const optionIndex = row.dataset.optionIndex;
        const val = button.dataset.value;

        // Visual active toggle
        row.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Update selection map
        this.selectedOptions[optionIndex] = val;

        // Resolve new variant and update card Add to Cart form
        this.updateVariant();
      }

      formatMoney(cents) {
        const amount = cents / 100;
        const formatted = amount.toLocaleString('en-IN', {
          maximumFractionDigits: 0,
          minimumFractionDigits: 0
        });
        return `₹${formatted}`;
      }

      updateVariant() {
        let matchedVariant = null;

        // Filter variants matching all selected options
        const possibleMatches = this.variants.filter(variant => {
          return Object.entries(this.selectedOptions).every(([index, val]) => {
            return variant.options[parseInt(index)] === val;
          });
        });

        if (possibleMatches.length > 0) {
          // Fallback to first available matching variant, or the first matched variant
          matchedVariant = possibleMatches.find(v => v.available) || possibleMatches[0];
        }

        if (matchedVariant) {
          // 1. Update Variant ID input field
          if (this.variantIdInput) {
            this.variantIdInput.value = matchedVariant.id;
            this.variantIdInput.removeAttribute('disabled');
          }

          // 2. Update price display inline
          const priceContainer = this.cardContainer?.querySelector('.custom-card-price');
          if (priceContainer) {
            const price = matchedVariant.price;
            const compareAtPrice = matchedVariant.compare_at_price;
            
            if (compareAtPrice && compareAtPrice > price) {
              const discountPercent = Math.round((compareAtPrice - price) * 100 / compareAtPrice);
              priceContainer.innerHTML = `
                <!-- Row 1: MRP Strikethrough -->
                <div class="custom-card-price__mrp" style="font-size: 1.3rem; color: #767676; text-decoration: line-through; line-height: 1.2;">
                  MRP ${this.formatMoney(compareAtPrice)}
                </div>
                <!-- Row 2: Price and Discount -->
                <div class="custom-card-price__row" style="display: flex; align-items: center; gap: 8px; line-height: 1.2;">
                  <span class="custom-card-price__selling" style="font-size: 1.6rem; font-weight: 700; color: #E30613;">
                    ${this.formatMoney(price)}
                  </span>
                  <span class="custom-card-price__discount" style="background-color: #E2F6EA; color: #107C41; font-size: 1.1rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: inline-block;">
                    ${discountPercent}% OFF
                  </span>
                </div>
              `;
            } else {
              priceContainer.innerHTML = `
                <!-- Regular Selling Price only -->
                <div class="custom-card-price__row" style="display: flex; align-items: center; line-height: 1.2;">
                  <span class="custom-card-price__selling" style="font-size: 1.6rem; font-weight: 700; color: #E30613;">
                    ${this.formatMoney(price)}
                  </span>
                </div>
              `;
            }
          }

          // 3. Swap image if variant-specific image exists
          const cardImage = this.cardContainer?.querySelector('.card__media img');
          if (cardImage) {
            if (matchedVariant.featured_image && matchedVariant.featured_image.src) {
              let imgUrl = matchedVariant.featured_image.src;
              cardImage.src = imgUrl;
              cardImage.srcset = imgUrl;
            } else {
              // Restore initial image
              if (cardImage.dataset.initialSrc) {
                cardImage.src = cardImage.dataset.initialSrc;
              }
              if (cardImage.dataset.initialSrcset) {
                cardImage.srcset = cardImage.dataset.initialSrcset;
              }
            }
          }

          // 4. Update submit button state
          if (this.submitButton) {
            if (matchedVariant.available) {
              this.submitButton.removeAttribute('disabled');
              this.submitButton.classList.remove('disabled');
              if (this.submitButtonText) {
                this.submitButtonText.textContent = '🛒 ADD TO CART';
              }
            } else {
              this.submitButton.setAttribute('disabled', 'disabled');
              this.submitButton.classList.add('disabled');
              if (this.submitButtonText) {
                this.submitButtonText.textContent = window.variantStrings?.soldOut || 'Sold out';
              }
            }
          }
        }
      }
    }
  );
}
