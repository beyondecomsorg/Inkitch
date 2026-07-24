#!/usr/bin/env python3
"""
Bulk Fix Missing Alt Text for Shopify Product Images

Usage:
  # Dry run (default):
  SHOPIFY_STORE_DOMAIN=inkitchonline.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx python scripts/fix_missing_alt_text.py

  # Execute live updates:
  SHOPIFY_STORE_DOMAIN=inkitchonline.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx python scripts/fix_missing_alt_text.py --commit
"""

import os
import sys
import re
import time
import json
import urllib.request
import urllib.parse
import urllib.error

STORE_DOMAIN = os.getenv("SHOPIFY_STORE_DOMAIN", "inkitchonline.myshopify.com")
ADMIN_TOKEN = os.getenv("SHOPIFY_ADMIN_TOKEN", "")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-01")
IS_DRY_RUN = "--commit" not in sys.argv and os.getenv("DRY_RUN", "true").lower() != "false"

COLOR_OPTION_REGEX = re.compile(r"^(colou?r|farbe|couleur|coloris|colore|cor|shade|finish|style)$", re.IGNORECASE)

def shopify_request(endpoint_url, data=None, method="GET", retries=5):
    if endpoint_url.startswith("http"):
        url = endpoint_url
    else:
        url = f"https://{STORE_DOMAIN}/admin/api/{API_VERSION}{endpoint_url}"

    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_TOKEN
    }

    req_data = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)

    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read().decode("utf-8")
                link_header = resp.headers.get("Link")
                return json.loads(resp_body), link_header
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = float(e.headers.get("Retry-After", 2.0))
                print(f" Rate limited (429). Waiting {retry_after}s (attempt {attempt}/{retries})...")
                time.sleep(retry_after + 0.5)
                continue
            else:
                error_body = e.read().decode("utf-8")
                raise Exception(f"Shopify API Error ({e.code} {e.reason}): {error_body}")
        except Exception as e:
            if attempt == retries:
                raise e
            backoff = (2 ** attempt) * 0.5
            print(f" Network error: {e}. Retrying in {backoff}s...")
            time.sleep(backoff)

def parse_next_link(link_header):
    if not link_header:
        return None
    for part in link_header.split(","):
        if 'rel="next"' in part:
            match = re.search(r"<([^>]+)>", part)
            if match:
                return match.group(1)
    return None

def main():
    print("====================================================")
    print("   SHOPIFY BULK ALT-TEXT FIXER (Python)")
    print("====================================================")
    print(f" Store Domain : {STORE_DOMAIN}")
    print(f" API Version  : {API_VERSION}")
    print(f" Mode         : {'DRY RUN (No changes saved)' if IS_DRY_RUN else 'COMMIT (Updating Shopify Admin live!)'}")
    print("====================================================\n")

    if not ADMIN_TOKEN:
        print("ERROR: SHOPIFY_ADMIN_TOKEN environment variable is missing.")
        print("Please set SHOPIFY_ADMIN_TOKEN and run again.\n")
        print("Example:")
        print("  SHOPIFY_ADMIN_TOKEN=shpat_xxxx python scripts/fix_missing_alt_text.py --commit\n")
        sys.exit(1)

    products_scanned = 0
    total_images_checked = 0
    skipped_already_has_alt = 0
    updated_images_count = 0
    action_log = []

    next_url = "/products.json?limit=250"

    while next_url:
        print("Fetching products page...")
        res_data, link_header = shopify_request(next_url)
        products = res_data.get("products", [])

        for product in products:
            products_scanned += 1
            title = product.get("title", "")
            options = product.get("options", [])
            color_opt_index = None

            for idx, opt in enumerate(options):
                opt_name = opt.get("name", "")
                if COLOR_OPTION_REGEX.match(opt_name) or "color" in opt_name.lower():
                    color_opt_index = idx + 1
                    break

            color_option_key = f"option{color_opt_index}" if color_opt_index else None

            # Map image_id -> assigned variant color name(s)
            image_variant_color_map = {}
            for variant in product.get("variants", []):
                img_id = variant.get("image_id")
                if img_id and color_option_key:
                    color_val = variant.get(color_option_key)
                    if color_val:
                        if img_id not in image_variant_color_map:
                            image_variant_color_map[img_id] = set()
                        image_variant_color_map[img_id].add(color_val.strip())

            for img in product.get("images", []):
                total_images_checked += 1
                img_id = img.get("id")
                existing_alt = img.get("alt")

                if existing_alt and str(existing_alt).strip():
                    skipped_already_has_alt += 1
                    continue

                assigned_colors = list(image_variant_color_map.get(img_id, []))
                if assigned_colors:
                    new_alt = " / ".join(assigned_colors)
                else:
                    new_alt = title

                updated_images_count += 1
                action_log.append({
                    "product_id": product.get("id"),
                    "product_title": title,
                    "image_id": img_id,
                    "new_alt": new_alt
                })

                print(f" [{'DRY-RUN' if IS_DRY_RUN else 'UPDATING'}] Product: \"{title}\" | Image ID: {img_id} => Alt: \"{new_alt}\"")

                if not IS_DRY_RUN:
                    shopify_request(
                        f"/products/{product.get('id')}/images/{img_id}.json",
                        data={"image": {"id": img_id, "alt": new_alt}},
                        method="PUT"
                    )

        next_url = parse_next_link(link_header)

    print("\n====================================================")
    print("   SUMMARY REPORT")
    print("====================================================")
    print(f" Total Products Scanned   : {products_scanned}")
    print(f" Total Images Examined    : {total_images_checked}")
    print(f" Skipped (Alt Text Exists): {skipped_already_has_alt}")
    print(f" Images {'Planned for Update' if IS_DRY_RUN else 'Updated'}: {updated_images_count}")
    print("====================================================\n")

    if action_log:
        print("Detailed Log of Updated Images:")
        for idx, item in enumerate(action_log, start=1):
            print(f"{idx}. [Product ID: {item['product_id']}] \"{item['product_title']}\"")
            print(f"   Image ID : {item['image_id']}")
            print(f"   New Alt  : \"{item['new_alt']}\"\n")
    else:
        print("All product images already have valid alt text! No updates needed.")

    if IS_DRY_RUN and updated_images_count > 0:
        print("\n----------------------------------------------------")
        print(" NOTE: This was a DRY RUN. No changes were committed to Shopify.")
        print(" To apply these updates live to your store, run:")
        print("   SHOPIFY_ADMIN_TOKEN=your_token python scripts/fix_missing_alt_text.py --commit")
        print("----------------------------------------------------\n")

if __name__ == "__main__":
    main()
