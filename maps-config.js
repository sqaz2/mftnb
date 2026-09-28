/* Public browser configuration. Use a website-restricted Google Maps browser key only.
 * See docs/MAPS-SETUP.md. Never put service-account or server credentials here.
 */
(function (root) {
  'use strict';
  const config = {
    browserKey: '',
    shop: {
      ownerProvidedAddress: '6834 59th ave, 806 Mustang Acres',
      formattedAddress: '',
      municipality: '',
      unit: '806',
      placeId: '',
      lat: null,
      lng: null,
      confirmed: false,
      confirmedBy: '',
      confirmedAt: ''
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  else root.MFTNB_MAPS_CONFIG = config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
