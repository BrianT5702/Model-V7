from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from model_builder.views import serve_react_app

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),
]

urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Production: serve the React app for every route that is not API or static.
if not settings.DEBUG:
    urlpatterns += [
        re_path(
            r'^(?!api/|static/|media/|manifest\.json|favicon\.ico|robots\.txt|logo[0-9]+\.png).*$',
            serve_react_app,
        ),
    ]