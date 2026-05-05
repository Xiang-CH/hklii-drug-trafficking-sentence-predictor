from src.agent import NATURAL_LANGUAGE_QUERY, stream_query


def main():
    stream_query(NATURAL_LANGUAGE_QUERY, verbose=True)


if __name__ == "__main__":
    main()
