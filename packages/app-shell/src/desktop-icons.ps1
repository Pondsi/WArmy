$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# R232：只读 Explorer/UI Automation；不注入输入、不改文件。
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WArmyDesktopView {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int Count(IntPtr h) { return SendMessage(h, 0x1004, IntPtr.Zero, IntPtr.Zero).ToInt32(); }
  public static IntPtr Find() {
    IntPtr result = IntPtr.Zero;
    EnumWindows((h,p) => {
      var view = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (view == IntPtr.Zero) return true;
      result = FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
      return result == IntPtr.Zero;
    }, IntPtr.Zero);
    return result;
  }
}
'@
  $handle = [WArmyDesktopView]::Find()
  if ($handle -eq [IntPtr]::Zero) { throw 'desktop-view-unavailable' }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
  $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $itemCount = [WArmyDesktopView]::Count($handle)
  $rawItems = @()
  foreach ($element in $elements) {
    $r = $element.Current.BoundingRectangle
    if (!$r.IsEmpty -and $r.Width -gt 0 -and $r.Height -gt 0) {
      $rawItems += [pscustomobject]@{ name=[string]$element.Current.Name; runtimeId=($element.GetRuntimeId() -join '-'); x=$r.X; y=$r.Y; width=$r.Width; height=$r.Height }
    }
  }
  if ($itemCount -gt 0 -and $rawItems.Count -eq 0) {
    $assembly = [Reflection.Assembly]::LoadWithPartialName('Accessibility')
    Add-Type -ReferencedAssemblies $assembly.Location -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Accessibility;
public static class WArmyDesktopMsaa {
  [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible acc);
  public class Item { public string name; public string runtimeId; public int x,y,width,height; }
  public static Item[] Read(IntPtr h, int count) {
    IAccessible acc;
    var iid = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
    if (AccessibleObjectFromWindow(h, 0xfffffffc, ref iid, out acc) != 0 || acc == null) return new Item[0];
    var result = new List<Item>();
    for (int i=1;i<=Math.Min(count,1000);i++) {
      try {
        var item = new Item { name=acc.get_accName(i), runtimeId="msaa-"+i };
        acc.accLocation(out item.x, out item.y, out item.width, out item.height, i);
        if (item.width>0 && item.height>0) result.Add(item);
      } catch (COMException) { }
    }
    return result.ToArray();
  }
}
'@
    $rawItems = @([WArmyDesktopMsaa]::Read($handle, $itemCount))
  }
  if ($itemCount -gt 0 -and $rawItems.Count -eq 0) { throw 'desktop-accessibility-unavailable' }
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.Namespace(0)
  $paths = @{}
  foreach ($item in $folder.Items()) {
    $name = [string]$item.Name
    if (!$paths.ContainsKey($name)) { $paths[$name] = @() }
    if ($item.IsFileSystem) { $paths[$name] += [string]$item.Path }
  }
  $icons = @()
  foreach ($element in $rawItems) {
    $name = [string]$element.name
    $r = $element
    $candidates = @($paths[$name] | Where-Object { $_ })
    $icons += [pscustomobject]@{
      name = $name
      runtimeId = [string]$element.runtimeId
      path = $(if ($candidates.Count -eq 1) { $candidates[0] } else { $null })
      ambiguous = ($candidates.Count -gt 1)
      rect = [pscustomobject]@{ x=$r.X; y=$r.Y; width=$r.Width; height=$r.Height }
    }
    if ($icons.Count -ge 1000) { break }
  }
  [pscustomobject]@{ ok=$true; icons=$icons; coordinateSpace='physical-pixels'; itemCount=$itemCount; truncated=($itemCount -gt 1000 -or $icons.Count -lt $itemCount) } | ConvertTo-Json -Depth 6 -Compress
} catch {
  [pscustomobject]@{ ok=$false; error=$_.Exception.Message; icons=@() } | ConvertTo-Json -Depth 3 -Compress
  exit 1
}
