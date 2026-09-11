import React, { createContext, useContext } from "react";

export const AppContext = createContext();

export function useApp() {
  return useContext(AppContext);
}
