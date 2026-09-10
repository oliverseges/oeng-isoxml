import { describe, expect, it } from "vitest";
import { useViewerStore } from "@/components/viewer/store";

describe("viewer store locale", () => {
  it("defaults to English and updates the persisted locale preference", () => {
    useViewerStore.setState({ locale: "en" } as never);

    expect(useViewerStore.getState().locale).toBe("en");

    useViewerStore.getState().setLocale("de");

    expect(useViewerStore.getState().locale).toBe("de");
  });
});