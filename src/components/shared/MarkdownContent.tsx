/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  children: string;
  /**
   * Heading offset. Document prose is often rendered beneath a drawer's own
   * <h2> title, so pass 2 to demote the document's own h1/h2/... by two levels
   * (h1→h3) and avoid skipping heading levels. Default 0 keeps them as-is.
   */
  headingOffset?: 0 | 2;
}

/**
 * Shared, readable renderer for document/answer Markdown. Uses remark-gfm so
 * GFM tables, strikethrough and task lists render properly — the SOP/policy
 * documents are full of pipe tables that otherwise show up as raw `| … |` text.
 * Styling is tuned for the light/dark drawers the app shows documents in.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ children, headingOffset = 0 }) => {
  const H = headingOffset === 2
    ? { h1: 'h3', h2: 'h4', h3: 'h5', h4: 'h6' }
    : { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4' };

  return (
    <div className="max-w-none text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => React.createElement(H.h1, { className: 'text-xl font-extrabold text-slate-900 dark:text-white mt-8 mb-4 tracking-tight', ...props }),
          h2: ({ node, ...props }) => React.createElement(H.h2, { className: 'text-lg font-bold text-slate-900 dark:text-white mt-7 mb-3 tracking-tight border-b border-slate-100 dark:border-slate-800 pb-2', ...props }),
          h3: ({ node, ...props }) => React.createElement(H.h3, { className: 'text-base font-bold text-slate-900 dark:text-white mt-6 mb-2.5 tracking-tight', ...props }),
          h4: ({ node, ...props }) => React.createElement(H.h4, { className: 'text-sm font-bold text-slate-800 dark:text-slate-200 mt-5 mb-2', ...props }),
          p: ({ node, ...props }) => <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-4" {...props} />,
          ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-1.5 text-sm text-slate-700 dark:text-slate-300 marker:text-slate-400" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-1.5 text-sm text-slate-700 dark:text-slate-300 marker:text-slate-400" {...props} />,
          li: ({ node, ...props }) => <li className="pl-0.5 leading-relaxed" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-semibold text-slate-900 dark:text-white" {...props} />,
          em: ({ node, ...props }) => <em className="italic text-slate-800 dark:text-slate-200" {...props} />,
          a: ({ node, ...props }) => <a className="text-brand-600 dark:text-brand-400 font-medium underline underline-offset-2 hover:text-brand-700 dark:hover:text-brand-300 break-words" target="_blank" rel="noopener noreferrer" {...props} />,
          blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-brand-300 dark:border-brand-700 pl-4 italic text-slate-600 dark:text-slate-400 my-4" {...props} />,
          hr: () => <hr className="my-6 border-slate-100 dark:border-slate-800" />,
          code: ({ node, ...props }) => <code className="bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 px-1.5 py-0.5 rounded text-[0.85em] font-mono" {...props} />,
          pre: ({ node, ...props }) => <pre className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 text-xs font-mono overflow-x-auto my-4" {...props} />,
          // GFM tables — the main readability fix. Wrapped so wide tables scroll
          // horizontally instead of blowing out the drawer width.
          table: ({ node, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs border-collapse" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => <thead className="bg-slate-50 dark:bg-slate-900/60" {...props} />,
          th: ({ node, ...props }) => <th className="text-left font-bold text-slate-700 dark:text-slate-200 px-3 py-2 border-b border-slate-200 dark:border-slate-800 whitespace-nowrap" {...props} />,
          td: ({ node, ...props }) => <td className="px-3 py-2 border-b border-slate-100 dark:border-slate-800/60 text-slate-600 dark:text-slate-300 align-top" {...props} />,
          tr: ({ node, ...props }) => <tr className="even:bg-slate-50/40 dark:even:bg-slate-900/20" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownContent;
