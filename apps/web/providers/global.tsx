"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import React from "react";
import { Toaster } from "~/components/ui/sonner";
import { TRPCProvider } from "~/providers/trpc";

export const GlobalProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <TRPCProvider>{children}</TRPCProvider>
      <Toaster />
    </NextThemesProvider>
  );
};
