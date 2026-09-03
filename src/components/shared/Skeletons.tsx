/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface SkeletonProps {
  count?: number;
}

/**
 * Replicates the structure of EnterpriseAnswer / Search result container.
 */
export const SearchResultSkeleton: React.FC = () => {
  return (
    <div className="w-full bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 rounded-sm shadow-xs space-y-5 font-sans">
      {/* Header: Title, Brand Pill, Confidence Score */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-2 flex-1 min-w-[250px]">
          <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-sm w-3/4 animate-pulse" />
          <div className="flex gap-2">
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-full w-16 animate-pulse" />
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-full w-24 animate-pulse" />
          </div>
        </div>
        <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-sm w-20 animate-pulse" />
      </div>

      {/* Main Body Answer Lines */}
      <div className="space-y-3 pt-2">
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-full animate-pulse" />
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-11/12 animate-pulse" />
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-full animate-pulse" />
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-4/5 animate-pulse" />
      </div>

      {/* Suggested Next Actions */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60 space-y-2">
        <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded-sm w-40 animate-pulse" />
        <div className="flex gap-2 flex-wrap">
          <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-sm w-32 animate-pulse" />
          <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-sm w-28 animate-pulse" />
        </div>
      </div>

      {/* References Section */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60 space-y-3">
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-32 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-sm space-y-2">
            <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded-sm w-2/3 animate-pulse" />
            <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-sm w-1/2 animate-pulse" />
          </div>
          <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-sm space-y-2">
            <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded-sm w-3/4 animate-pulse" />
            <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-sm w-1/3 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Replicates rows of documents in library view.
 */
export const DocumentListSkeleton: React.FC<SkeletonProps> = ({ count = 5 }) => {
  return (
    <div className="w-full bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-sm divide-y divide-slate-100 dark:divide-slate-800/80 font-sans">
      {/* Table Header Placeholder */}
      <div className="p-4 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-4">
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-1/4 animate-pulse" />
        <div className="flex gap-4">
          <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-16 animate-pulse" />
          <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-24 animate-pulse" />
          <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-16 animate-pulse" />
        </div>
      </div>

      {/* Rows */}
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* File Icon placeholder */}
            <div className="h-8 w-8 bg-slate-200 dark:bg-slate-800 rounded-sm flex-shrink-0 animate-pulse" />
            {/* Name and upload info */}
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-2/3 max-w-[320px] animate-pulse" />
              <div className="flex items-center gap-2">
                <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-sm w-16 animate-pulse" />
                <span className="text-slate-300 dark:text-slate-700 text-xs">•</span>
                <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-sm w-20 animate-pulse" />
              </div>
            </div>
          </div>

          {/* Status, Department, Metrics */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-16 animate-pulse hidden md:block" />
            <div className="h-6 bg-slate-100 dark:bg-slate-800 rounded-full w-20 animate-pulse" />
            <div className="h-8 w-8 bg-slate-100 dark:bg-slate-800 rounded-sm animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Replicates the Metric Cards layout.
 */
export const MetricCardSkeleton: React.FC<SkeletonProps> = ({ count = 3 }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 font-sans">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-sm space-y-4 shadow-xs">
          {/* Header & Icon */}
          <div className="flex items-center justify-between">
            <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded-sm w-24 animate-pulse" />
            <div className="h-7 w-7 bg-slate-200 dark:bg-slate-800 rounded-full animate-pulse" />
          </div>
          {/* Main big stat */}
          <div className="space-y-1.5">
            <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-sm w-1/3 animate-pulse" />
            <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm w-2/3 animate-pulse" />
          </div>
          {/* Bottom trend info */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-sm w-16 animate-pulse" />
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-sm w-12 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Replicates the Governance Review Task rows/cards.
 */
export const GovernanceTaskSkeleton: React.FC<SkeletonProps> = ({ count = 4 }) => {
  return (
    <div className="space-y-3 font-sans">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-sm shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2 flex-1 min-w-0">
            {/* Title / document name placeholder */}
            <div className="h-4.5 bg-slate-200 dark:bg-slate-800 rounded-sm w-3/4 max-w-[400px] animate-pulse" />
            
            {/* Task Meta details */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm w-24 animate-pulse" />
              <span className="text-slate-200 dark:text-slate-800">•</span>
              <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm w-32 animate-pulse" />
              <span className="text-slate-200 dark:text-slate-800">•</span>
              <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm w-16 animate-pulse" />
            </div>
          </div>

          {/* Action pills / buttons */}
          <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
            <div className="h-6 bg-slate-100 dark:bg-slate-800 rounded-full w-20 animate-pulse" />
            <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-sm w-24 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
};
