/**
 * Bulk Fix Missing Alt Text for Shopify Product Images
 * 
 * Usage:
 *   # Dry run (default):
 *   SHOPIFY_STORE_DOMAIN=inkitchonline.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx node scripts/fix-missing-alt-text.js
 * 
 *   # Execute live updates:
 *   SHOPIFY_STORE_DOMAIN=inkitchonline.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx node scripts/fix-missing-alt-text.js --commit
 */

const fs = require('fs');
const path = require('path');

// Configuration from environment or CLI arguments
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'inkitchonline.myshopify.com';
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const IS_DRY_RUN = !process.argv.includes('--commit') && process.env.DRY_RUN !== 'false';

const COLOR_OPTION_REGEX = /^(colou?r|farbe|couleur|coloris|colore|cor|shade|finish|style)$/i;

/**
 * Helper to make rate-limited & auto-retrying fetch calls to Shopify REST API
 */
async function shopifyRequest(endpointUrl, options = {}, retries = 5) {
  const url = endpointUrl.startsWith('http')
    ? endpointUrl
    : `https://${STORE_DOMAIN}/admin/api/${API_VERSION}${endpointUrl}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ADMIN_TOKEN,
    ...options.headers,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers });

      if (res.status === 429) {
        const retryAfter = parseFloat(res.headers.get('Retry-After') || '2.0');
        console.warn(` Rate limited (429). Waiting ${retryAfter}s (attempt ${attempt}/${retries})...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 + 500));
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Shopify API error (${res.status} ${res.statusText}): ${errorText}`);
      }

      const linkHeader = res.headers.get('Link');
      const data = await res.json();
      return { data, linkHeader };
    } catch (err) {
      if (attempt === retries) throw err;
      const backoff = Math.pow(2, attempt) * 500;
      console.warn(` Network error: ${err.message}. Retrying in ${backoff}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

/**
 * Parses pagination Link header to find the next page URL
 */
function getNextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const links = linkHeader.split(',');
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/i);
    if (match) return match[1];
  }
  return null;
}

/**
 * Main Execution Function
 */
async function main() {
  console.log('====================================================');
  console.log('   SHOPIFY BULK ALT-TEXT FIXER');
  console.log('====================================================');
  console.log(` Store Domain : ${STORE_DOMAIN}`);
  console.log(` API Version  : ${API_VERSION}`);
  console.log(` Mode         : ${IS_DRY_RUN ? 'DRY RUN (No changes will be saved)' : 'COMMIT (Updating Shopify Admin live!)'}`);
  console.log('====================================================\n');

  if (!ADMIN_TOKEN) {
    console.error('ERROR: SHOPIFY_ADMIN_TOKEN environment variable is missing.');
    console.error('Please set SHOPIFY_ADMIN_TOKEN and run again.\n');
    console.error('Example:');
    console.error('  SHOPIFY_ADMIN_TOKEN=shpat_xxxx node scripts/fix-missing-alt-text.js --commit\n');
    process.exit(1);
  }

  let productsScanned = 0;
  let totalImagesChecked = 0;
  let skippedAlreadyHasAlt = 0;
  let updatedImagesCount = 0;
  const actionLog = [];

  let nextUrl = `/products.json?limit=250`;

  while (nextUrl) {
    console.log(`Fetching products page...`);
    const { data, linkHeader } = await shopifyRequest(nextUrl);
    const products = data.products || [];

    for (const product of products) {
      productsScanned++;

      // Identify option index for "Color"
      const options = product.options || [];
      const colorOptionIndex = options.findIndex((opt) => COLOR_OPTION_REGEX.test(opt.name) || /color/i.test(opt.name));
      const colorOptionKey = colorOptionIndex !== -1 ? `option${colorOptionIndex + 1}` : null;

      // Map image_id -> assigned variant color name(s)
      const imageVariantColorMap = {};
      if (product.variants && Array.isArray(product.variants)) {
        for (const variant of product.variants) {
          if (variant.image_id) {
            const colorVal = colorOptionKey ? variant[colorOptionKey] : null;
            if (colorVal) {
              if (!imageVariantColorMap[variant.image_id]) {
                imageVariantColorMap[variant.image_id] = new Set();
              }
              imageVariantColorMap[variant.image_id].add(colorVal.trim());
            }
          }
        }
      }

      const images = product.images || [];

      for (const img of images) {
        totalImagesChecked++;

        // Skip images that already have non-empty alt text
        if (img.alt && String(img.alt).trim() !== '') {
          skippedAlreadyHasAlt++;
          continue;
        }

        // Determine new Alt Text:
        let newAltText = '';

        const assignedColors = imageVariantColorMap[img.id] ? Array.from(imageVariantColorMap[img.id]) : [];
        if (assignedColors.length > 0) {
          newAltText = assignedColors.join(' / ');
        } else {
          // Fallback to product title if not assigned to a specific variant color
          newAltText = product.title;
        }

        updatedImagesCount++;
        actionLog.push({
          productId: product.id,
          productTitle: product.title,
          imageId: img.id,
          src: img.src,
          newAltText,
        });

        console.log(` [${IS_DRY_RUN ? 'DRY-RUN' : 'UPDATING'}] Product: "${product.title}" | Image ID: ${img.id} => Alt: "${newAltText}"`);

        if (!IS_DRY_RUN) {
          await shopifyRequest(`/products/${product.id}/images/${img.id}.json`, {
            method: 'PUT',
            body: JSON.stringify({
              image: {
                id: img.id,
                alt: newAltText,
              },
            }),
          });
        }
      }
    }

    nextUrl = getNextPageUrl(linkHeader);
  }

  console.log('\n====================================================');
  console.log('   SUMMARY REPORT');
  console.log('====================================================');
  console.log(` Total Products Scanned   : ${productsScanned}`);
  console.log(` Total Images Examined    : ${totalImagesChecked}`);
  console.log(` Skipped (Alt Text Exists): ${skippedAlreadyHasAlt}`);
  console.log(` Images ${IS_DRY_RUN ? 'Planned for Update' : 'Updated'}: ${updatedImagesCount}`);
  console.log('====================================================\n');

  if (actionLog.length > 0) {
    console.log('Detailed Log of Updated Images:');
    actionLog.forEach((item, idx) => {
      console.log(`${idx + 1}. [Product ID: ${item.productId}] "${item.productTitle}"`);
      console.log(`   Image ID : ${item.imageId}`);
      console.log(`   New Alt  : "${item.newAltText}"\n`);
    });
  } else {
    console.log('All product images already have valid alt text! No updates needed.');
  }

  if (IS_DRY_RUN && updatedImagesCount > 0) {
    console.log('\n----------------------------------------------------');
    console.log(' NOTE: This was a DRY RUN. No changes were committed to Shopify.');
    console.log(' To apply these updates live to your store, run:');
    console.log('   SHOPIFY_ADMIN_TOKEN=your_token node scripts/fix-missing-alt-text.js --commit');
    console.log('----------------------------------------------------\n');
  }
}

main().catch((err) => {
  console.error('\n Fatal Error encountered during script execution:');
  console.error(err);
  process.exit(1);
});
