/// <reference types="vite/client" />

interface BerryDesktopBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BerryDesktopBrowserCapture {
  data: string;
  mediaType: string;
  width: number;
  height: number;
  url: string;
  title?: string;
}

interface Window {
  berryDesktopBrowser?: {
    isAvailable(): boolean;
    navigate(url: string): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    setBounds(bounds: BerryDesktopBrowserBounds & { visible: boolean }): Promise<void>;
    capture(): Promise<BerryDesktopBrowserCapture>;
  };
}
