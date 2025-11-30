import json
import os
import markdown
from datetime import datetime

# Get the absolute path to the directory containing this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Assume the script is in a 'scripts' folder at the root of the website
WEBSITE_ROOT = os.path.dirname(SCRIPT_DIR)

def generate_post_html(md_content, title, date):
    html_template = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{title} | Ryan Anselm</title>
        <link rel="stylesheet" type="text/css" href="../../style.css">
        <link rel="icon" type="image/x-icon" href="../../assets/favicon.ico">
    </head>
    <body>
        <header>
            <div class="header-content">
                <div class="header-top">
                    <h1><a href="../../" class="home-link">Ryan Anselm</a></h1>
                    <nav>
                        <h2><a href="../" class="blog-link">Blog</a></h2>
                    </nav>
                </div>
            </div>
        </header>
        <h1 class="blog-title">{title}</h1>
        <p class="post-date">{date}</p>
        <article>
            {markdown.markdown(md_content)}
        </article>
    </body>
    </html>
    """
    return html_template

def generate_blog_index(posts):
    if posts:
        posts_html = "\n".join([
            f'<li><a href="generated/{post["filename"]}.html">{post["title"]}</a>'
            f'<span class="post-date">{post["date"]}</span></li>'
            for post in posts
        ])
    else:
        posts_html = '<li>No posts yet — check back soon.</li>'
    index_html = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>blog | Ryan Anselm</title>
        <link rel="stylesheet" type="text/css" href="../style.css">
        <link rel="icon" type="image/x-icon" href="../assets/favicon.ico">
    </head>
    <body>
        <header>
            <div class="header-content">
                <div class="header-top">
                    <h1><a href="../" class="home-link">Ryan Anselm</a></h1>
                </div>
                <p align="justify">
                    Welcome to my blog! You can browse my posts below.
                </p>
            </div>
            <img id="photo" src="../assets/bear.jpeg" alt="polar bear">
        </header>
        <main>
            <ul class="post-list">
                {posts_html}
            </ul>
        </main>
    </body>
    </html>
    """
    return index_html

def main():
    posts_dir = os.path.join(WEBSITE_ROOT, "blog", "posts")
    generated_dir = os.path.join(WEBSITE_ROOT, "blog", "generated")
    
    if not os.path.exists(generated_dir):
        os.makedirs(generated_dir)

    posts = []
    for filename in os.listdir(posts_dir):
        if filename.endswith(".md"):
            post_path = os.path.join(posts_dir, filename)
            with open(post_path, "r") as f:
                md_content = f.read()
            
            date = filename[:10]
            title = filename[11:-3].replace("-", " ").title()
            
            html_content = generate_post_html(md_content, title, date)
            
            output_filename = f"{os.path.splitext(filename)[0]}.html"
            output_path = os.path.join(generated_dir, output_filename)
            with open(output_path, "w") as f:
                f.write(html_content)
            
            post_date = datetime.strptime(date, "%Y-%m-%d")
            posts.append({
                "filename": os.path.splitext(filename)[0],
                "title": title,
                "date": post_date.strftime("%B %d, %Y"),
                "iso_date": post_date.strftime("%Y-%m-%d")
            })

    # Sort posts by date, most recent first
    posts.sort(key=lambda x: x["iso_date"], reverse=True)
    
    # Generate blog index
    index_html = generate_blog_index(posts)
    blog_index_path = os.path.join(WEBSITE_ROOT, "blog", "index.html")
    with open(blog_index_path, "w") as f:
        f.write(index_html)

    posts_json = [
        {
            "title": post["title"],
            "date": post["date"],
            "url": f"blog/generated/{post['filename']}.html"
        }
        for post in posts
    ]
    posts_json_path = os.path.join(generated_dir, "posts.json")
    with open(posts_json_path, "w") as f:
        json.dump(posts_json, f, indent=4)

if __name__ == "__main__":
    main()
