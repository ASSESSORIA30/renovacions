"use client";
/** Substitut de `next/link`: enllaç real (accessible, copiable) que navega dins del shell sense recarregar. */
import { forwardRef } from "react";
import { useApp } from "@/data/store";
import { hrefFor, resolveHref } from "./routes";

type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; prefetch?: boolean };

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, onClick, prefetch, ...rest }, ref) {
  void prefetch;
  const { view, params } = resolveHref(href);
  return (
    <a
      ref={ref}
      href={hrefFor(view, params)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        useApp.getState().navigate(view, params);
      }}
      {...rest}
    />
  );
});

export default Link;
