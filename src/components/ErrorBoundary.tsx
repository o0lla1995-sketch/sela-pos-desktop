/**
 * components/ErrorBoundary.tsx — حاجز أخطاء العرض (React DOM).
 * ─────────────────────────────────────────────────────────────────
 * أي استثناء داخل شاشة (بيانات فاسدة، NULL غير متوقع، ترقية قاعدة
 * قديمة…) كان يسقط التطبيق كله إلى شاشة بيضاء صامتة («الشاشة لا
 * تعمل»). الآن كل شاشة محصّنة: الحاجز يعرض بطاقة عربية واضحة مع
 * زر إعادة المحاولة (إعادة تركيب الشاشة فقط) وزر إعادة تشغيل
 * كامل، ويسجّل التفاصيل في سجل التشخيصات — العملية لا تتوقف
 * أبداً بسبب شاشة واحدة.
 */
import React from 'react';
import {logDiag} from '../core/diagnostics';

interface Props {
  children: React.ReactNode;
  /** اسم القسم للتمييز في السجل والرسالة. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logDiag(
      'ui',
      `سقط عرض «${this.props.label ?? 'شاشة'}»: ${error.message} ${
        info.componentStack?.split('\n')[1] ?? ''
      }`,
      'error',
    );
  }

  private reset = (): void => {
    this.setState({error: null});
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error != null) {
      return (
        <div className="eb-wrap">
          <div className="eb-card">
            <div className="eb-icon" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 8v5m0 3.5v.5M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="eb-title">
              تعذّر عرض {this.props.label ?? 'هذه الشاشة'}
            </div>
            <div className="eb-text">
              حدث خطأ غير متوقع أثناء رسم القسم — بياناتك محفوظة وسليمة،
              والباقي من النظام يعمل. جرّب الإعادة، وإن تكرر الخطأ أعد
              تشغيل البرنامج.
            </div>
            <div className="eb-detail" dir="ltr">
              {this.state.error.message}
            </div>
            <div className="eb-actions">
              <button className="btn ghost" onClick={this.reload}>
                إعادة تشغيل البرنامج
              </button>
              <button className="btn primary" onClick={this.reset}>
                إعادة المحاولة
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
