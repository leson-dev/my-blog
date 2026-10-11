import { createContext, useContext } from "react";
import type { Endpoints } from "./api/endpoints";

export interface Services {
  api: Endpoints;
  auth: { logout(): void };
}

const ServicesContext = createContext<Services | null>(null);

export const ServicesProvider = ServicesContext.Provider;

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("ServicesProvider is missing");
  return services;
}
