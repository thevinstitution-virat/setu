export function getLocation(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({}),
      { timeout: 4000 }
    );
  });
}
