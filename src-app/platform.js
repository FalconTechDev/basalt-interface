// Platform: the plugin-API object that tells what the app runs on. The basic flags start false and are set during start-up
// (desktop / mobile detection happens elsewhere); the derived capabilities are getters so that they follow those flags.

export function definePlatform(host) {
  const Platform = {
    isDesktop: false,
    isMobile: false,
    isDesktopApp: false,
    isMobileApp: false,
    isIosApp: false,
    isAndroidApp: false,
    isPhone: false,
    isTablet: false,
    isMacOS: host.isMacOS,
    isWin: host.isWindows,
    isLinux: host.isLinux,
    isSafari: host.isSafari,
    resourcePathPrefix: "file:///",
    get canExportPdf() { return Platform.isDesktopApp; },
    get canPopoutWindow() { return Platform.isDesktopApp && Platform.isDesktop; },
    get canStackTabs() { return !Platform.isPhone; },
    get canSplit() { return !Platform.isPhone; },
    get canDisplayRibbon() { return !Platform.isPhone; },
    get canPinSidebar() { return Platform.isMobile && !Platform.isPhone; },
    supportsIndexedDb: !!window.indexedDB,
    mobileSoftKeyboardVisible: false,
    hasPhysicalKeyboard: false,
    version: "",
    build: "",
    manufacturer: "",
    model: "",
    osName: "",
    osVersion: "",
    deviceName: "",
  };
  return Platform;
}
