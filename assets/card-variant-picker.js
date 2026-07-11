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

        if (matchedVariant && this.variantIdInput) {
          this.variantIdInput.value = matchedVariant.id;
          this.variantIdInput.removeAttribute('disabled');

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
