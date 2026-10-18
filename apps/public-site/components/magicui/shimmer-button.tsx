'use client';

// Adapted from Magic UI's MIT-licensed ShimmerButton; see vendor/README.md.
// Original DOM structure and CSS animation retained; Tailwind classes become local CSS.
import React, { type ComponentPropsWithoutRef, type CSSProperties } from 'react';

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<'button'> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  ({ shimmerColor = '#a8fff0', shimmerSize = '1px', shimmerDuration = '4s', borderRadius = '6px', background = '#0e1f2e', className = '', children, ...props }, ref) => (
    <button ref={ref} style={{ '--spread': '90deg', '--shimmer-color': shimmerColor, '--radius': borderRadius, '--speed': shimmerDuration, '--cut': shimmerSize, '--bg': background } as CSSProperties} className={`shimmer-button ${className}`} {...props}>
      <span className="shimmer-container" aria-hidden="true"><span className="shimmer-slide"><span className="shimmer-spin" /></span></span>
      <span className="shimmer-label">{children}</span>
      <span className="shimmer-highlight" aria-hidden="true" />
      <span className="shimmer-backdrop" aria-hidden="true" />
    </button>
  ),
);
ShimmerButton.displayName = 'ShimmerButton';
