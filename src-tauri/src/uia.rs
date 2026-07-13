use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationTextPattern,
    TextPatternRangeEndpoint_Start, TextPatternRangeEndpoint_End,
    TextUnit_Character, UIA_TextPatternId,
};
use windows::core::Interface;

/// Tries to move the caret left by `offset` characters via UI Automation TextPattern.
/// Returns `true` if the focused control supports TextPattern and the caret was moved.
/// Returns `false` if TextPattern is not available (caller should do nothing).
pub fn try_set_cursor(offset: usize) -> bool {
    unsafe {
        if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
            return false;
        }
        let ok = try_set_cursor_inner(offset);
        CoUninitialize();
        ok
    }
}

unsafe fn try_set_cursor_inner(offset: usize) -> bool {
    let automation: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
        Ok(a) => a,
        Err(_) => return false,
    };

    let element = match automation.GetFocusedElement() {
        Ok(e) => e,
        Err(_) => return false,
    };

    let pattern_unknown = match element.GetCurrentPattern(UIA_TextPatternId) {
        Ok(p) => p,
        Err(_) => return false,
    };

    let text_pattern: IUIAutomationTextPattern = match pattern_unknown.cast() {
        Ok(p) => p,
        Err(_) => return false,
    };

    let selection_array = match text_pattern.GetSelection() {
        Ok(a) => a,
        Err(_) => return false,
    };

    if !matches!(selection_array.Length(), Ok(l) if l > 0) {
        return false;
    }

    let selection = match selection_array.GetElement(0) {
        Ok(s) => s,
        Err(_) => return false,
    };

    if selection
        .MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -(offset as i32))
        .is_err()
    {
        return false;
    }

    if selection
        .MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, -(offset as i32))
        .is_err()
    {
        return false;
    }

    selection.Select().is_ok()
}
