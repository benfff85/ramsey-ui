package com.setminusx.ramsey.ui.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

/**
 * Cache headers for the single-page app.
 *
 * index.html names the current bundle, so browsers must revalidate it on every load (a 304 when
 * unchanged). Without a Cache-Control header they cached it heuristically for hours, and an open
 * dashboard kept running the previous build, including API calls that build removed, after a
 * deploy (2026-10-08). The bundle and stylesheet are named by content hash, so a changed file
 * always gets a new name and they can be cached for a year.
 */
@Configuration
public class StaticCacheConfig implements WebMvcConfigurer {

    private static final String STATIC = "classpath:/META-INF/resources/";

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/index.html")
                .addResourceLocations(STATIC)
                .setCacheControl(CacheControl.noCache());
        registry.addResourceHandler("/assets/**")
                .addResourceLocations(STATIC + "assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
    }
}
