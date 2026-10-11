import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { onTestFinished, vi } from "vitest";
import type { Endpoints } from "../src/api/endpoints";
import { BuildProvider } from "../src/build/BuildProvider";
import { type Services, ServicesProvider } from "../src/context";

const notStubbed = (name: string) =>
  vi.fn(async () => {
    throw new Error(`api.${name} is not stubbed in this test`);
  });

/** An Endpoints object whose unstubbed calls fail loudly. */
export function fakeApi(overrides: Partial<Record<keyof Endpoints, unknown>> = {}): Endpoints {
  const base: Record<keyof Endpoints, unknown> = {
    listPosts: vi.fn(async () => []),
    getPost: notStubbed("getPost"),
    createPost: notStubbed("createPost"),
    updatePost: notStubbed("updatePost"),
    deletePost: notStubbed("deletePost"),
    upsertVersion: notStubbed("upsertVersion"),
    deleteVersion: notStubbed("deleteVersion"),
    publish: notStubbed("publish"),
    unpublish: notStubbed("unpublish"),
    listTags: vi.fn(async () => []),
    putTag: notStubbed("putTag"),
    createUpload: notStubbed("createUpload"),
    latestBuild: vi.fn(async () => ({
      status: "success",
      updatedAt: "2026-10-11T00:00:00.000Z",
      error: null,
    })),
    triggerBuild: vi.fn(async () => ({
      status: "queued",
      updatedAt: "2026-10-11T00:00:00.000Z",
      error: null,
    })),
  };
  return { ...base, ...overrides } as unknown as Endpoints;
}

export function renderWithServices(ui: ReactElement, api: Endpoints = fakeApi()) {
  const services: Services = {
    api,
    auth: { logout: vi.fn() },
    uploadImage: vi.fn(async (file: File) => `https://blog.oki-dev.xyz/media/2026/${file.name}`),
  };
  // A data router (as in main.tsx) on jsdom's real history: `useBlocker` works and tests can
  // assert on `location` after navigation.
  const router = createBrowserRouter([
    {
      path: "*",
      element: (
        <ServicesProvider value={services}>
          <BuildProvider>{ui}</BuildProvider>
        </ServicesProvider>
      ),
    },
  ]);
  onTestFinished(() => router.dispose());
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, api, services };
}
