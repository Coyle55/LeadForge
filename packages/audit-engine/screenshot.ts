export type ScreenshotResult =
  | { status: "captured"; url: string }
  | { status: "unavailable"; reason: string };

export interface ScreenshotProvider {
  capture: (url: string) => Promise<ScreenshotResult>;
}

export const noopScreenshotProvider: ScreenshotProvider = {
  capture: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured" }),
};
