import React from 'react';
import styles from './surface.module.css';

export interface SurfaceProps {
  variant?: 'default' | 'glass' | 'ink' | 'frost' | 'champagne-glow' | 'lavender-glow' | 'sapphire-glow';
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Surface({
  variant = 'default',
  padding = 'md',
  className = '',
  children,
  style,
}: SurfaceProps) {
  return (
    <div
      className={[styles.surface, variant !== 'default' ? styles[variant] : '', styles[`padded-${padding}`], className]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {children}
    </div>
  );
}
