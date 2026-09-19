import React from 'react';

interface LapisLazuliIconProps {
  className?: string;
  size?: number;
}

export const LapisLazuliIcon: React.FC<LapisLazuliIconProps> = ({ className = 'w-6 h-6', size }) => {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="Lapis Lazuli Mineral"
    >
      {/* Outer Faceted Mineral Nugget */}
      <path
        d="M7 3.5L15 2L20.5 6.5L22 14L17 21.5L9 22.5L3 17L2 9.5L7 3.5Z"
        fill="url(#lapisGrad)"
        stroke="#0f172a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* Internal Gem Facets */}
      <path
        d="M7 3.5L13 9L15 2"
        stroke="#93c5fd"
        strokeWidth="0.9"
        strokeLinejoin="round"
        opacity="0.8"
      />
      <path
        d="M13 9L20.5 6.5L22 14L15.5 15.5L13 9Z"
        fill="#1d4ed8"
        opacity="0.7"
      />
      <path
        d="M13 9L15.5 15.5L9.5 18L7 10.5L13 9Z"
        fill="#2563eb"
      />
      <path
        d="M7 10.5L3 17L9 22.5L9.5 18L7 10.5Z"
        fill="#1e3a8a"
        opacity="0.9"
      />
      <path
        d="M15.5 15.5L17 21.5L9 22.5"
        stroke="#172554"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />

      {/* Highlight Facet Edge */}
      <path
        d="M7 3.5L13 9L9.5 18"
        stroke="#bfdbfe"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.6"
      />

      {/* Iconic Minecraft Pyrite Golden Flecks */}
      <rect x="10" y="12" width="1.8" height="1.8" rx="0.4" fill="#fbbf24" />
      <rect x="15" y="11" width="1.4" height="1.4" rx="0.3" fill="#fde047" />
      <rect x="12.5" y="15.5" width="1.6" height="1.6" rx="0.3" fill="#f59e0b" />
      <rect x="5.5" y="8.5" width="1.2" height="1.2" rx="0.3" fill="#fbbf24" opacity="0.8" />

      {/* Gradients */}
      <defs>
        <linearGradient id="lapisGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="0.4" stopColor="#2563eb" />
          <stop offset="0.75" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#0f2b6e" />
        </linearGradient>
      </defs>
    </svg>
  );
};
