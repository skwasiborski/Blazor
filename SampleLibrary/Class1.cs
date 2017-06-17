using System;
using Blazor.Interop;

namespace SampleLibrary
{
    public class Program
    {
        static void Main(string[] args)
        {
        }

        public static int Alert(string text)
        {
            Browser.Alert(text);
            return 0;
        }
    }
}
