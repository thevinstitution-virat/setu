/** One location fix (4 s timeout). accuracy is in metres. Empty when denied or unavailable. */
export function getLocation(): Promise<{ lat?: number; lng?: number; accuracy?: number }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
      () => resolve({}),
      { timeout: 4000 }
    );
  });
}
